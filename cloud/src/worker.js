import * as source from "./desco.js";
import {
  auditBalance,
  auditReceipt,
  costLine,
  dailyDeltas,
  dhakaDate,
  historyReport,
  instant,
  money,
  monthRange,
  num,
  periodReport,
  receiptReport,
  shift,
  statusReport,
} from "./finance.js";
import {
  commit,
  drain,
  ensureUser,
  lockUser,
  release,
  telegram,
  track,
} from "./store.js";

export const COMMANDS = {
  start: "Connect your own DESCO meter",
  connect: "Link account and meter numbers",
  status: "Latest balance and daily cost",
  today: "Today or the latest available day",
  week: "Previous seven days",
  month: "This month’s daily costs",
  recharges: "Latest recharge breakdown",
  history: "Recent recharge history",
  language: "Choose English or বাংলা",
  usage_history: "Monthly recharge and daily-cost groups",
  audit: "Check receipt amounts",
  schedule: "Choose daily or weekly reports",
  alerts: "Set recharge and low-balance alerts",
  settings: "Show your settings",
  pause: "Pause automatic messages",
  resume: "Resume automatic messages",
  disconnect: "Remove your meter data",
  clear: "Clear recent chat messages",
  export: "Download your saved readings",
  help: "Commands and examples",
};
const HELP = `⚡ Zeus DescoBuddy
Connect only your own meter:
/connect ACCOUNT_NUMBER METER_NUMBER

/status · /today · /week · /month
/recharges — latest recharge
/history — last 35 days
/usage_history — this month
/usage_history 2026-10 — choose a month
/audit · /export

/schedule daily 08:00
/schedule weekly fri 20:00
/schedule off
/alerts low default — ৳500, ৳300, ৳200
/alerts low 600 (or off) — one custom limit
/alerts recharge on (or off)
/alerts mismatch on (or off)
/language bn — বাংলা · /language en — English
/pause · /resume · /settings
/clear — recent messages (Telegram limits apply)
/disconnect — remove your meter data

Times are Bangladesh time. DESCO may publish readings late. Each user's data is separate. Free hosting has capacity limits.`;
const MENU = {
  inline_keyboard: [
    [
      { text: "⚡ Status", callback_data: "status" },
      { text: "📊 Today", callback_data: "today" },
    ],
    [
      { text: "💳 Latest recharge", callback_data: "recharges" },
      { text: "📒 Usage history", callback_data: "usage_history" },
    ],
    [
      { text: "📜 Recharge history", callback_data: "history" },
      { text: "🔎 Audit", callback_data: "audit" },
    ],
    [{ text: "বাংলা / English", callback_data: "language" }],
  ],
};
const DEFAULT_LOW = ["500", "300", "200"];
const balanceKey = (b) =>
  b
    ? JSON.stringify([b.readingTime, b.balance, b.currentMonthConsumption])
    : null;
const completeDays = (state) =>
  Object.fromEntries(
    dailyDeltas(state.cache?.daily?.data)
      .filter(
        (r) => r.date < dhakaDate() && r.units !== null && r.cost !== null,
      )
      .map((r) => [r.date, JSON.stringify([r.units, r.cost])]),
  );
function initializeReadingBaseline(state) {
  if (state.readingSeen) return;
  state.readingSeen = {
    balance: balanceKey(state.cache?.balance?.data),
    days: completeDays(state),
  };
}
export class InputError extends Error {}
export function privateUser(update) {
  const message = update.callback_query?.message || update.message;
  const user = update.callback_query?.from || update.message?.from;
  if (
    !message ||
    !user ||
    user.is_bot ||
    message.chat?.type !== "private" ||
    user.id !== message.chat.id ||
    !Number.isSafeInteger(user.id) ||
    user.id <= 0
  )
    return null;
  return String(user.id);
}
export async function refresh(state, { force = false } = {}) {
  if (!state.profile)
    throw new InputError("Connect first: /connect ACCOUNT_NUMBER METER_NUMBER");
  if (!force && state.lastRefresh && Date.now() - state.lastRefresh < 30000)
    return;
  const today = dhakaDate(),
    start = [`${today.slice(0, 7)}-01`, shift(today, -7)].sort()[0];
  const results = await Promise.allSettled([
    source.balance(state.profile),
    source.daily(state.profile, shift(start, -1), today),
    source.recharges(state.profile, shift(today, -35), today),
  ]);
  state.cache ||= {};
  state.failures = [];
  for (let i = 0; i < results.length; i++) {
    const name = ["balance", "daily", "recharges"][i],
      result = results[i];
    if (result.status === "rejected") {
      state.failures.push(name);
      continue;
    }
    if (
      name === "balance" &&
      instant(result.value.readingTime) <
        instant(state.cache.balance?.data?.readingTime)
    ) {
      state.failures.push(name);
      continue;
    }
    if (
      name === "balance" &&
      instant(result.value.readingTime) >
        instant(state.cache.balance?.data?.readingTime)
    )
      state.previousBalance = state.cache.balance?.data;
    state.cache[name] = { at: Date.now(), data: result.value };
  }
  state.lastRefresh = Date.now();
}
export function scheduleSlot(schedule, now = Date.now()) {
  const local = new Date(now + 21600000),
    today = local.toISOString().slice(0, 10),
    time = local.toISOString().slice(11, 16);
  if (!schedule) return null;
  let days = 0;
  if (schedule.mode === "daily") days = time < schedule.time ? 1 : 0;
  else {
    days = (local.getUTCDay() - schedule.weekday + 7) % 7;
    if (days === 0 && time < schedule.time) days = 7;
  }
  return `${shift(today, -days)}T${schedule.time}+06:00`;
}
function notifications(state) {
  const out = [],
    receipts = state.cache?.recharges?.data || [],
    b = state.cache?.balance?.data;
  state.alerts ||= { recharge: true, mismatch: true, low: DEFAULT_LOW };
  // Existing users had a single ৳200 default. Keep explicit custom limits.
  if (state.alerts.low === "200" && !state.lowDefaultsMigrated)
    state.alerts.low = DEFAULT_LOW;
  state.lowDefaultsMigrated = true;
  state.seen ||= {};
  state.pending ||= {};
  if (!state.failures?.includes("recharges") && state.cache?.recharges) {
    const seen = {};
    for (const r of receipts) {
      if (!r.orderID) continue;
      const id = String(r.orderID),
        fingerprint = JSON.stringify(r);
      if (
        state.seenInitialized &&
        state.seen[id] !== fingerprint &&
        !state.paused
      ) {
        if (state.alerts.recharge) {
          out.push({
            event: `recharge:${id}:${fingerprint}`,
            text: receiptReport(r, b, receipts),
          });
          if (
            !instant(b?.readingTime) ||
            instant(b.readingTime) < instant(r.rechargeDate)
          )
            state.pending[id] = r;
        }
      }
      if (
        state.alerts.mismatch &&
        !state.paused &&
        auditReceipt(r).state === "difference" &&
        state.seen[id] !== fingerprint
      )
        out.push({
          event: `audit:${id}:${fingerprint}`,
          text: `⚠️ Recharge ${r.rechargeDate}: receipt difference ${money(auditReceipt(r).difference)}. /audit for details.`,
        });
      seen[id] = fingerprint;
    }
    state.seen = seen;
    state.seenInitialized = true;
  }
  if (state.paused) {
    state.pending = {};
    initializeReadingBaseline(state);
    if (!state.failures?.includes("daily"))
      state.readingSeen.days = {
        ...state.readingSeen.days,
        ...completeDays(state),
      };
    if (!state.failures?.includes("balance"))
      state.readingSeen.balance = balanceKey(b);
    return [];
  }
  initializeReadingBaseline(state);
  const newReadings = [];
  if (!state.failures?.includes("daily")) {
    const current = completeDays(state);
    for (const [date, fingerprint] of Object.entries(current))
      if (state.readingSeen.days[date] !== fingerprint) {
        const row = dailyDeltas(state.cache.daily.data).find(
          (r) => r.date === date,
        );
        newReadings.push(
          `${state.readingSeen.days[date] ? "Updated" : "Day"} ${date}: ${costLine(row)}`,
        );
      }
    state.readingSeen.days = Object.fromEntries(
      Object.entries({ ...state.readingSeen.days, ...current }).filter(
        ([date]) => date >= shift(dhakaDate(), -45),
      ),
    );
  }
  if (!state.failures?.includes("balance") && b) {
    const fingerprint = balanceKey(b);
    if (state.readingSeen.balance && state.readingSeen.balance !== fingerprint)
      newReadings.push(
        `Balance: ${money(b.balance)}\nMeter reading: ${b.readingTime || "Pending"} Dhaka`,
      );
    state.readingSeen.balance = fingerprint;
  }
  if (newReadings.length)
    out.push({
      event: `reading:${JSON.stringify(state.readingSeen)}`,
      text: `📥 New DESCO reading\n${newReadings.join("\n")}`,
    });
  if (!state.failures?.includes("balance")) {
    for (const [id, r] of Object.entries(state.pending))
      if (instant(b?.readingTime) >= instant(r.rechargeDate)) {
        if (state.alerts.recharge)
          out.push({
            event: `after:${id}`,
            text: `⚡ Balance reading after recharge\nBalance: ${money(b.balance)}\nReading: ${b.readingTime} Dhaka\nIncludes any usage since payment.`,
          });
        delete state.pending[id];
      }
    const thresholds = (
      Array.isArray(state.alerts.low)
        ? state.alerts.low
        : state.alerts.low == null
          ? []
          : [state.alerts.low]
    )
      .map(num)
      .filter((v) => v !== null)
      .sort((a, b) => b.cmp(a));
    const value = num(b?.balance);
    state.lowNotified ||= {};
    if (value !== null) {
      for (const threshold of thresholds)
        if (value.gte(threshold))
          delete state.lowNotified[threshold.toString()];
    }
    const crossed =
      value === null
        ? []
        : thresholds.filter(
            (threshold) =>
              value.lt(threshold) && !state.lowNotified[threshold.toString()],
          );
    if (crossed.length) {
      for (const threshold of crossed)
        state.lowNotified[threshold.toString()] = true;
      const threshold = crossed.at(-1);
      out.push({
        event: `low:${threshold}:${balanceKey(b)}`,
        text: `⚠️ Balance below ${money(threshold)}\nBalance: ${money(value)}\nMeter reading: ${b.readingTime || "Pending"} Dhaka`,
      });
    }
  }
  if (state.schedule) {
    const slot = scheduleSlot(state.schedule),
      at = instant(slot);
    const end = shift(slot.slice(0, 10), -1),
      start = shift(end, state.schedule.mode === "weekly" ? -6 : 0);
    const rows = new Map(
      dailyDeltas(state.cache?.daily?.data).map((r) => [r.date, r]),
    );
    let complete = !state.failures?.includes("daily");
    for (let d = start; d <= end; d = shift(d, 1))
      if (rows.get(d)?.units == null || rows.get(d)?.cost == null)
        complete = false;
    if (
      at >= state.schedule.enabled &&
      (state.lastSlot !== slot || (!state.lastReportComplete && complete))
    ) {
      const followup = state.lastSlot === slot;
      out.push({
        event: `schedule:${state.schedule.enabled}:${slot}:${followup ? "complete" : "initial"}`,
        text:
          (followup ? "🔄 Missing readings arrived\n" : "") +
          periodReport(state, start, end),
      });
      state.lastSlot = slot;
      state.lastReportComplete = complete;
    }
  }
  return out;
}
async function clearChat(env, id, latest) {
  const { results } = await env.DB.prepare(
    "SELECT id FROM messages WHERE user_id=? AND sent>?",
  )
    .bind(id, Date.now() - 172800000)
    .all();
  // Bounded to the same private chat. Keep under free Worker subrequest limits.
  const ids = [
    ...new Set([
      ...results.map((r) => r.id),
      ...Array.from({ length: Math.min(1000, latest) }, (_, i) => latest - i),
    ]),
  ].sort((a, b) => b - a);
  let blocked = false,
    retries = 0;
  for (let i = 0; i < ids.length && i < 1000; i += 100) {
    try {
      await telegram(env, "deleteMessages", {
        chat_id: id,
        message_ids: ids.slice(i, i + 100),
      });
    } catch (e) {
      if (e.code !== 400) {
        blocked = true;
        break;
      }
      for (const mid of ids.slice(i, i + 100)) {
        if (retries++ >= 30) {
          blocked = true;
          break;
        }
        try {
          await telegram(env, "deleteMessage", {
            chat_id: id,
            message_id: mid,
          });
        } catch (err) {
          if (err.code !== 400) {
            blocked = true;
            break;
          }
        }
      }
      if (blocked) break;
    }
    await env.DB.batch(
      ids
        .slice(i, i + 100)
        .map((n) =>
          env.DB.prepare("DELETE FROM messages WHERE user_id=? AND id=?").bind(
            id,
            n,
          ),
        ),
    );
  }
  return `${blocked ? "Telegram could not delete some messages." : "Finished clearing eligible recent messages."}\nOnly recent messages can be deleted by bots (up to 1,000 IDs per request). Use Telegram Clear History for the entire chat. Your meter data is kept.`;
}
function auditReport(state) {
  const rs = state.cache?.recharges?.data || [],
    audits = rs.map(auditReceipt);
  const lines = [
    "🔎 Receipt checks",
    `Checked: ${rs.length}`,
    `Amounts match: ${audits.filter((a) => a.state === "matched").length}`,
    `Differences: ${audits.filter((a) => a.state === "difference").length}`,
    `Missing details: ${audits.filter((a) => a.state === "pending").length}`,
  ];
  audits.forEach((a, i) => {
    if (a.state === "difference")
      lines.push(`${rs[i].rechargeDate}: ${money(a.difference)}`);
  });
  lines.push(auditBalance(state));
  lines.push(
    "A match checks receipt arithmetic, not tariff legality or meter accuracy. Independent tariff checks are not enabled.",
  );
  if (state.failures?.length)
    lines.push("⚠️ Some data could not refresh; check is incomplete.");
  return lines.join("\n");
}
async function command(env, id, state, update) {
  const message = update.callback_query?.message || update.message;
  const text = update.callback_query?.data || message.text || "";
  const [raw, ...args] = text.trim().split(/\s+/),
    name = raw?.replace(/^\//, "").split("@")[0].toLowerCase();
  if (name === "start" && ["bn", "en"].includes(args[0]))
    state.language = args[0];
  if (name === "language") {
    if (!args.length)
      return {
        text: "Choose /language bn for বাংলা or /language en for English.",
      };
    if (!["bn", "en"].includes(args[0]) || args.length !== 1)
      throw new InputError("Use /language bn or /language en.");
    state.language = args[0];
    return {
      text:
        args[0] === "bn" ? "ভাষা বাংলা করা হয়েছে।" : "Language set to English.",
    };
  }
  if (name === "start" || name === "help" || !COMMANDS[name])
    return { text: HELP, markup: MENU };
  if (name === "clear")
    return { text: await clearChat(env, id, message.message_id) };
  if (name === "connect") {
    if (
      args.length !== 2 ||
      !/^\d{5,20}$/.test(args[0]) ||
      !/^\d{5,24}$/.test(args[1])
    )
      throw new InputError(
        "Use /connect ACCOUNT_NUMBER METER_NUMBER\nOnly connect a meter you own or have permission to manage.",
      );
    if (
      state.profile &&
      (state.profile.account !== args[0] || state.profile.meter !== args[1])
    )
      throw new InputError("Use /disconnect before switching meters.");
    state.profile = await source.discover(args[0], args[1]);
    await refresh(state, { force: true });
    initializeReadingBaseline(state);
    if (!state.seenInitialized) {
      state.seen = {};
      for (const r of state.cache?.recharges?.data || [])
        if (r.orderID) state.seen[r.orderID] = JSON.stringify(r);
      state.seenInitialized = !state.failures.includes("recharges");
    }
    return {
      text: `Connected ✅\n${statusReport(state)}\nUse /schedule daily 08:00 for reports.`,
      markup: MENU,
    };
  }
  if (!state.profile)
    throw new InputError("Connect first: /connect ACCOUNT_NUMBER METER_NUMBER");
  if (name === "disconnect") {
    if (args[0] !== "confirm")
      return {
        text: "Remove your saved meter, readings and schedules? Send /disconnect confirm. Telegram chat messages remain.",
      };
    for (const k of Object.keys(state)) delete state[k];
    await env.DB.prepare("DELETE FROM outbox WHERE user_id=?").bind(id).run();
    return {
      text: "Your saved meter data and schedules were removed. /connect to start again.",
    };
  }
  if (name === "pause" || name === "resume") {
    state.paused = name === "pause";
    state.pending = {};
    if (!state.paused && state.schedule) state.schedule.enabled = Date.now();
    await env.DB.prepare("DELETE FROM outbox WHERE user_id=?").bind(id).run();
    return {
      text: state.paused
        ? "Automatic messages paused."
        : "Automatic messages resumed.",
    };
  }
  if (name === "settings")
    return {
      text: `⚙️ Settings\nAccount: ••••${state.profile.account.slice(-4)}\nLanguage: ${state.language === "bn" ? "বাংলা" : "English"}\nTimezone: Asia/Dhaka\nSchedule: ${state.schedule ? `${state.schedule.mode} ${state.schedule.time}` : "off"}\nAutomatic messages: ${state.paused ? "paused" : "on"}\nBackground checks: approximately ${Number(env.POLL_SECONDS || 900) / 60} minutes; may take longer at free-plan capacity.\nRecharge alerts: ${state.alerts?.recharge ? "on" : "off"}\nLow balance alerts: ${state.alerts?.low == null ? "off" : (Array.isArray(state.alerts?.low) ? state.alerts.low : [state.alerts.low]).map(money).join(", ")}`,
    };
  if (name === "schedule") {
    if (args[0] === "off") {
      delete state.schedule;
      return { text: "Scheduled reports off." };
    }
    const mode = args[0],
      time = args.at(-1),
      days = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
    if (
      !["daily", "weekly"].includes(mode) ||
      !/^([01]\d|2[0-3]):[0-5]\d$/.test(time || "") ||
      (mode === "daily"
        ? args.length !== 2
        : args.length !== 3 || !days.includes(args[1]))
    )
      throw new InputError(
        "Use /schedule daily 08:00 or /schedule weekly fri 20:00 (Bangladesh time).",
      );
    state.schedule = {
      mode,
      time,
      weekday: mode === "weekly" ? days.indexOf(args[1]) : null,
      enabled: Date.now(),
    };
    delete state.lastSlot;
    return {
      text: `Reports set: ${args.join(" ")} Bangladesh time. Delivery can be delayed by free hosting or DESCO.`,
    };
  }
  if (name === "alerts") {
    state.alerts ||= { recharge: true, mismatch: true, low: DEFAULT_LOW };
    const [type, value] = args;
    if (
      type === "low" &&
      (value === "off" || value === "default" || num(value)?.gte(0))
    ) {
      state.alerts.low =
        value === "off"
          ? null
          : value === "default"
            ? DEFAULT_LOW
            : [num(value).toString()];
      state.lowDefaultsMigrated = true;
      state.lowNotified = {};
    } else if (
      ["recharge", "mismatch"].includes(type) &&
      ["on", "off"].includes(value)
    )
      state.alerts[type] = value === "on";
    else
      throw new InputError(
        "Use /alerts low default, /alerts low 600, /alerts low off, /alerts recharge on, or /alerts mismatch on.",
      );
    return { text: "Alert setting saved." };
  }
  if (name === "usage_history") {
    let start, end;
    try {
      [start, end] = monthRange(args[0] || dhakaDate().slice(0, 7));
    } catch (e) {
      throw new InputError(e.message);
    }
    const [daily, receipts] = await Promise.all([
      source.daily(state.profile, shift(start, -1), end),
      source.recharges(state.profile, start, end),
    ]);
    return { text: historyReport(daily, receipts, start, end) };
  }
  await refresh(state);
  const today = dhakaDate(),
    receipts = (state.cache?.recharges?.data || []).toSorted((a, b) =>
      String(b.rechargeDate).localeCompare(String(a.rechargeDate)),
    );
  if (name === "status") return { text: statusReport(state), markup: MENU };
  if (["today", "week", "month"].includes(name)) {
    const end = name === "week" ? shift(today, -1) : today,
      start =
        name === "today"
          ? today
          : name === "week"
            ? shift(end, -6)
            : `${today.slice(0, 7)}-01`;
    return { text: periodReport(state, start, end) };
  }
  if (name === "recharges")
    return {
      text:
        (state.failures?.includes("recharges")
          ? "⚠️ Using saved receipts.\n"
          : "") +
        (receipts[0]
          ? receiptReport(
              receipts[0],
              state.cache?.balance?.data,
              state.failures?.includes("recharges") ? null : receipts,
            )
          : "No recharge received in the last 35 days."),
    };
  if (name === "history")
    return {
      text: [
        "📜 Recharges — last 35 days",
        ...(receipts.length
          ? receipts.map(
              (r) =>
                `${r.rechargeDate}: ${money(r.totalAmount)} → ${money(r.energyAmount)} · ${r.orderStatus}`,
            )
          : ["No records received."]),
        ...(state.failures?.includes("recharges")
          ? ["⚠️ Saved data; refresh failed."]
          : []),
      ].join("\n"),
    };
  if (name === "audit") return { text: auditReport(state) };
  if (name === "export")
    return {
      document: JSON.stringify(
        {
          account: state.profile.account,
          meter: state.profile.meter,
          exported: new Date().toISOString(),
          readings: state.cache,
          failures: state.failures,
          daily: dailyDeltas(state.cache?.daily?.data),
        },
        null,
        2,
      ),
      text: "Your saved financial readings. Keep this file private.",
    };
  return { text: HELP };
}
async function validSecret(request, env) {
  if (!env.WEBHOOK_SECRET) return false;
  const given = request.headers.get("X-Telegram-Bot-Api-Secret-Token") || "";
  const [a, b] = await Promise.all(
    [given, env.WEBHOOK_SECRET].map((s) =>
      crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)),
    ),
  );
  return new Uint8Array(a).every((v, i) => v === new Uint8Array(b)[i]);
}
export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    if (path === "/health" && request.method === "GET")
      return Response.json({ service: "Zeus DescoBuddy", status: "running" });
    if (path === "/ready" && request.method === "POST") {
      if (!(await validSecret(request, env)))
        return new Response("Forbidden", { status: 403 });
      try {
        await env.DB.prepare("SELECT id FROM users LIMIT 1").first();
        await source.request("tkdes", "getBalance", "0000000000");
        await telegram(env, "getMe", {});
        return Response.json({ database: true, desco: true, telegram: true });
      } catch {
        return Response.json({ ready: false }, { status: 503 });
      }
    }
    if (path !== "/telegram" || request.method !== "POST")
      return new Response("Not found", { status: 404 });
    if (!(await validSecret(request, env)))
      return new Response("Forbidden", { status: 403 });
    if (Number(request.headers.get("Content-Length") || 0) > 65536)
      return new Response("Too large", { status: 413 });
    const raw = await request.text();
    if (raw.length > 65536) return new Response("Too large", { status: 413 });
    let update;
    try {
      update = JSON.parse(raw);
    } catch {
      return new Response("Invalid JSON", { status: 400 });
    }
    if (!Number.isSafeInteger(update.update_id))
      return new Response("Invalid update", { status: 400 });
    const id = privateUser(update);
    if (!id) return new Response("OK");
    let locked;
    try {
      if (
        await env.DB.prepare("SELECT id FROM updates WHERE id=?")
          .bind(update.update_id)
          .first()
      )
        return new Response("OK");
      if (!(await ensureUser(env, id))) {
        await telegram(env, "sendMessage", {
          chat_id: id,
          text: "This free instance has reached its user capacity. Please try later.",
        });
        return new Response("OK");
      }
      locked = await lockUser(env, id);
      if (!locked) return new Response("Busy", { status: 503 });
      if (
        await env.DB.prepare("SELECT id FROM updates WHERE id=?")
          .bind(update.update_id)
          .first()
      )
        return new Response("OK");
      if (update.callback_query)
        await telegram(env, "answerCallbackQuery", {
          callback_query_id: update.callback_query.id,
        });
      else await track(env, id, update.message);
      let response;
      if (Date.now() - locked.last_command < 3000)
        response = { text: "Please wait a few seconds between commands." };
      else
        try {
          response = await command(env, id, locked.state, update);
        } catch (e) {
          if (e instanceof InputError || e instanceof source.SourceError)
            response = { text: e.message };
          else throw e;
        }
      const messages = [{ ...response, event: `reply:${update.update_id}` }];
      await commit(env, locked, messages, update.update_id);
      // A delivery failure leaves the encrypted outbox entry for the cron retry.
      try {
        await drain(env, id);
      } catch {}
      return new Response("OK");
    } catch {
      return new Response("Temporary failure", { status: 503 });
    } finally {
      if (locked) await release(env, id, locked.lease);
    }
  },
  async scheduled(controller, env) {
    const now = Date.now();
    await env.DB.batch([
      env.DB.prepare("DELETE FROM updates WHERE done<?").bind(
        now - 7 * 86400000,
      ),
      env.DB.prepare("DELETE FROM messages WHERE sent<?").bind(now - 172800000),
    ]);
    const { results } = await env.DB.prepare(
      "SELECT id FROM users WHERE (active=1 AND due<=?) OR EXISTS(SELECT 1 FROM outbox WHERE outbox.user_id=users.id) ORDER BY due LIMIT ?",
    )
      .bind(now, Math.min(2, Number(env.CRON_BATCH || 2)))
      .all();
    for (const { id } of results) {
      const locked = await lockUser(env, id);
      if (!locked) continue;
      try {
        const messages = [];
        if (locked.state.profile && locked.due <= now) {
          initializeReadingBaseline(locked.state);
          await refresh(locked.state);
          messages.push(...notifications(locked.state));
        }
        await commit(env, locked, messages);
        await drain(env, id);
      } catch (e) {
        if (e.code === 403) {
          locked.state.paused = true;
          await env.DB.prepare("DELETE FROM outbox WHERE user_id=?")
            .bind(id)
            .run();
          await commit(env, locked, []);
        }
      } finally {
        await release(env, id, locked.lease);
      }
    }
  },
};
