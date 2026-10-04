import { localizeMarkup, renderMessage } from "./i18n.js";

const enc = new TextEncoder(),
  dec = new TextDecoder();
const to64 = (bytes) =>
  btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join(""));
const from64 = (text) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
async function key(env) {
  const raw = from64(env.DATA_KEY || "");
  if (raw.length !== 32)
    throw new Error("DATA_KEY must be 32 bytes, base64 encoded.");
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}
export async function seal(env, user, value) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: enc.encode(String(user)) },
    await key(env),
    enc.encode(JSON.stringify(value)),
  );
  return `${to64(iv)}.${to64(new Uint8Array(data))}`;
}
export async function unseal(env, user, value) {
  const [iv, data] = value.split(".");
  return JSON.parse(
    dec.decode(
      await crypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv: from64(iv),
          additionalData: enc.encode(String(user)),
        },
        await key(env),
        from64(data),
      ),
    ),
  );
}
export async function ensureUser(env, id) {
  const existing = await env.DB.prepare("SELECT id FROM users WHERE id=?")
    .bind(id)
    .first();
  if (existing) return true;
  const payload = await seal(env, id, {
    cache: {},
    seen: {},
    alerts: { mismatch: false, customLow: null },
    language: "en",
    paused: false,
  });
  const result = await env.DB.prepare(
    "INSERT OR IGNORE INTO users(id,payload) SELECT ?,? WHERE (SELECT COUNT(*) FROM users) < ?",
  )
    .bind(id, payload, Number(env.MAX_USERS || 50))
    .run();
  return (
    result.meta.changes > 0 ||
    !!(await env.DB.prepare("SELECT id FROM users WHERE id=?").bind(id).first())
  );
}
export async function lockUser(env, id) {
  const lease = crypto.randomUUID(),
    now = Date.now();
  const result = await env.DB.prepare(
    "UPDATE users SET lease=?,lease_until=? WHERE id=? AND lease_until<?",
  )
    .bind(lease, now + 180000, id, now)
    .run();
  if (!result.meta.changes) return null;
  const row = await env.DB.prepare("SELECT * FROM users WHERE id=? AND lease=?")
    .bind(id, lease)
    .first();
  return { ...row, state: await unseal(env, id, row.payload) };
}
export async function release(env, id, lease) {
  await env.DB.prepare(
    "UPDATE users SET lease=NULL,lease_until=0 WHERE id=? AND lease=?",
  )
    .bind(id, lease)
    .run();
}
export function chunks(text, size = 3500) {
  const result = [];
  let current = "";
  for (const line of text.split("\n")) {
    if (line.length > size) {
      if (current) result.push(current);
      current = "";
      for (let i = 0; i < line.length; i += size)
        result.push(line.slice(i, i + size));
      continue;
    }
    if (current.length + line.length + 1 > size) {
      result.push(current);
      current = "";
    }
    current += (current ? "\n" : "") + line;
  }
  if (current) result.push(current);
  return result;
}
export async function commit(env, locked, messages, updateId = null) {
  const id = locked.id,
    payload = await seal(env, id, locked.state),
    now = Date.now();
  const due =
    updateId === null
      ? now + Number(env.POLL_SECONDS || 900) * 1000
      : locked.due;
  const statements = [
    env.DB.prepare(
      "UPDATE users SET payload=?,active=?,due=?,last_command=? WHERE id=? AND lease=? AND lease_until>?",
    ).bind(
      payload,
      locked.state.profile ? 1 : 0,
      due,
      updateId === null ? locked.last_command : now,
      id,
      locked.lease,
      now,
    ),
  ];
  for (const message of messages) {
    const digest = await crypto.subtle.digest(
      "SHA-256",
      enc.encode(message.event),
    );
    const eventKey = Array.from(new Uint8Array(digest), (b) =>
      b.toString(16).padStart(2, "0"),
    ).join("");
    const parts = chunks(renderMessage(message.text, locked.state.language));
    for (let i = 0; i < parts.length; i++)
      statements.push(
        env.DB.prepare(
          "INSERT OR IGNORE INTO outbox(user_id,event,payload,created) SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM users WHERE id=? AND lease=? AND lease_until>?)",
        ).bind(
          id,
          `${eventKey}:${i}`,
          await seal(env, id, {
            text: parts[i],
            sourceEvent: message.event,
            markup: localizeMarkup(message.markup, locked.state.language),
            document: i === 0 ? message.document : undefined,
          }),
          now,
          id,
          locked.lease,
          now,
        ),
      );
  }
  if (updateId !== null)
    statements.push(
      env.DB.prepare(
        "INSERT OR IGNORE INTO updates(id,user_id,done) SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM users WHERE id=? AND lease=? AND lease_until>?)",
      ).bind(updateId, id, now, id, locked.lease, now),
    );
  const results = await env.DB.batch(statements);
  if (!results[0].meta.changes)
    throw new Error("User lease expired before commit.");
}
export async function track(env, id, message) {
  if (!Number.isSafeInteger(message?.message_id)) return;
  await env.DB.prepare(
    "INSERT OR REPLACE INTO messages(user_id,id,sent) VALUES(?,?,?)",
  )
    .bind(id, message.message_id, message.date * 1000)
    .run();
}
export async function dropQueuedExtras(
  env,
  id,
  { schedule = false, mismatch = false, customLow = null } = {},
) {
  const { results } = await env.DB.prepare(
    "SELECT event,payload FROM outbox WHERE user_id=?",
  )
    .bind(id)
    .all();
  for (const row of results) {
    const content = await unseal(env, id, row.payload);
    const event = content.sourceEvent || "";
    const old = content.text || "";
    const remove =
      (schedule &&
        (event.startsWith("schedule:") ||
          /^<b>(📊 Usage:|📊 বিদ্যুৎ ব্যবহার:|🔄 Missing readings arrived|🔄 অপেক্ষার রিডিং এসেছে)/.test(
            old,
          ))) ||
      (mismatch &&
        (event.startsWith("audit:") ||
          /^<b>⚠️ Recharge .*receipt difference/.test(old))) ||
      (customLow !== null &&
        (event.startsWith(`extra-low:${customLow}:`) ||
          old.includes(`below ৳${Number(customLow).toFixed(2)}`)));
    if (remove)
      await env.DB.prepare("DELETE FROM outbox WHERE user_id=? AND event=?")
        .bind(id, row.event)
        .run();
  }
}
export async function telegram(env, method, payload) {
  let response;
  try {
    response = await fetch(
      `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(15000),
      },
    );
  } catch {
    throw new Error("Telegram connection failed.");
  }
  const result = await response.json();
  if (!result.ok) {
    const error = new Error("Telegram request failed.");
    error.code = result.error_code;
    error.retryAfter = result.parameters?.retry_after;
    throw error;
  }
  return result.result;
}
export async function drain(env, id) {
  const { results } = await env.DB.prepare(
    "SELECT event,payload FROM outbox WHERE user_id=? ORDER BY created,event LIMIT 5",
  )
    .bind(id)
    .all();
  for (const row of results) {
    const content = await unseal(env, id, row.payload);
    let message;
    if (content.document) {
      const form = new FormData();
      form.set("chat_id", id);
      form.set("caption", content.text);
      form.set("parse_mode", "HTML");
      form.set(
        "document",
        new Blob([content.document], { type: "application/json" }),
        "descobuddy-readings.json",
      );
      let response;
      try {
        response = await fetch(
          `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendDocument`,
          { method: "POST", body: form, signal: AbortSignal.timeout(15000) },
        );
      } catch {
        throw new Error("Telegram export delivery failed.");
      }
      const body = await response.json();
      if (!body.ok) {
        const e = new Error("Telegram export rejected.");
        e.code = body.error_code;
        throw e;
      }
      message = body.result;
    } else
      message = await telegram(env, "sendMessage", {
        chat_id: id,
        text: content.text,
        parse_mode: "HTML",
        reply_markup: content.markup,
      });
    await track(env, id, message);
    await env.DB.prepare("DELETE FROM outbox WHERE user_id=? AND event=?")
      .bind(id, row.event)
      .run();
  }
}
