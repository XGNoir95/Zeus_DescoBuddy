import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { unseal, seal } from "../src/store.js";
import { dhakaDate, shift } from "../src/finance.js";

test(
  "real Worker/D1 boundary: webhook auth, two users, replay, export and disconnect isolation",
  { timeout: 90000 },
  async () => {
    const calls = [],
      secrets = {
        WEBHOOK_SECRET: "test-webhook-secret",
        DATA_KEY: randomBytes(32).toString("base64"),
        TELEGRAM_BOT_TOKEN: "123456:TEST_TOKEN_NOT_REAL",
      };
    let telegramId = 100;
    let secondBalance = "202.00";
    let secondReadingTime = dhakaDate() + " 00:00:00";
    let addedDailyCost = 0;
    const mf = new Miniflare(
      convertV4MiniflareOptions({
        modules: true,
        scriptPath: new URL(
          "../.wrangler/build/worker.js",
          import.meta.url,
        ).pathname.replace(/^\/([A-Z]:)/i, "$1"),
        compatibilityDate: "2026-10-04",
        d1Databases: ["DB"],
        bindings: {
          ...secrets,
          POLL_SECONDS: "900",
          MAX_USERS: "50",
          CRON_BATCH: "2",
        },
        outboundService: async (request) => {
          const url = new URL(request.url);
          if (url.hostname === "api.telegram.org") {
            const method = url.pathname.split("/").at(-1);
            const payload = request.headers
              .get("content-type")
              ?.startsWith("multipart")
              ? Object.fromEntries(await request.formData())
              : await request.json();
            calls.push({ method, payload });
            return Response.json({
              ok: true,
              result:
                method === "getMe"
                  ? {
                      id: 123456,
                      is_bot: true,
                      username: "test_bot",
                      first_name: "Test",
                    }
                  : {
                      message_id: telegramId++,
                      date: Math.floor(Date.now() / 1000),
                      chat: { id: Number(payload.chat_id), type: "private" },
                    },
            });
          }
          assert.equal(url.hostname, "prepaid.desco.org.bd");
          const account = url.searchParams.get("accountNo"),
            meter = account + "99";
          let data;
          if (url.pathname.includes("/unified/")) data = null;
          else if (url.pathname.endsWith("getCustomerInfo"))
            data = {
              accountNo: account,
              meterNo: meter,
              customerName: "DO NOT STORE",
            };
          else if (url.pathname.endsWith("getBalance"))
            data = {
              accountNo: account,
              meterNo: meter,
              balance: account === "123456" ? "101.00" : secondBalance,
              readingTime:
                account === "123456"
                  ? dhakaDate() + " 00:00:00"
                  : secondReadingTime,
              currentMonthConsumption: "600",
            };
          else if (url.pathname.endsWith("getRechargeHistory")) data = [];
          else {
            data = [];
            for (
              let d = url.searchParams.get("dateFrom");
              d <= url.searchParams.get("dateTo");
              d = shift(d, 1)
            )
              data.push({
                date: d,
                meterNo: meter,
                consumedUnit: Date.parse(d) / 8640000,
                consumedTaka:
                  Number(d.slice(-2)) * 60 +
                  (account === "654321" && d === shift(dhakaDate(), -1)
                    ? addedDailyCost
                    : 0),
              });
          }
          return Response.json({ code: 200, data });
        },
      }),
    );
    try {
      const db = await mf.getD1Database("DB");
      const schema = await readFile(
        new URL("../migrations/0001_initial.sql", import.meta.url),
        "utf8",
      );
      for (const statement of schema.split(";").filter((s) => s.trim()))
        await db.prepare(statement).run();
      let sequence = 1;
      async function send(
        id,
        text,
        updateId = sequence++,
        secret = secrets.WEBHOOK_SECRET,
      ) {
        await db
          .prepare("UPDATE users SET last_command=0 WHERE id=?")
          .bind(String(id))
          .run();
        return mf.dispatchFetch("http://localhost/telegram", {
          method: "POST",
          headers: { "X-Telegram-Bot-Api-Secret-Token": secret },
          body: JSON.stringify({
            update_id: updateId,
            message: {
              message_id: updateId,
              date: Math.floor(Date.now() / 1000),
              from: { id },
              chat: { id, type: "private" },
              text,
            },
          }),
        });
      }
      assert.equal((await send(42, "/start", 900, "wrong")).status, 403);
      assert.equal(
        (await db.prepare("SELECT COUNT(*) AS n FROM users").first()).n,
        0,
      );
      assert.equal((await send(42, "/connect 123456 12345699")).status, 200);
      assert.equal((await send(43, "/connect 654321 65432199")).status, 200);
      const a = await db
          .prepare("SELECT payload FROM users WHERE id=?")
          .bind("42")
          .first(),
        b = await db
          .prepare("SELECT payload FROM users WHERE id=?")
          .bind("43")
          .first();
      assert.equal(
        (await unseal(secrets, "42", a.payload)).profile.account,
        "123456",
      );
      assert.equal(
        (await unseal(secrets, "43", b.payload)).profile.account,
        "654321",
      );
      assert.ok(!a.payload.includes("123456"));
      await assert.rejects(unseal(secrets, "43", a.payload));
      const before = calls.length;
      await send(42, "/status", 800);
      const after = calls.length;
      assert.ok(after > before);
      await send(42, "/status", 800);
      assert.equal(calls.length, after);
      assert.match(
        calls
          .filter(
            (c) =>
              c.method === "sendMessage" && String(c.payload.chat_id) === "42",
          )
          .at(-1).payload.text,
        /101.00/,
      );
      assert.ok(
        !calls
          .filter(
            (c) =>
              c.method === "sendMessage" && String(c.payload.chat_id) === "42",
          )
          .at(-1)
          .payload.text.includes("202.00"),
      );
      await send(43, "/export");
      assert.equal(calls.at(-1).method, "sendDocument");
      assert.equal(calls.at(-1).payload.parse_mode, "HTML");
      await send(42, "/disconnect confirm");
      assert.equal(
        (
          await unseal(
            secrets,
            "42",
            (
              await db
                .prepare("SELECT payload FROM users WHERE id=?")
                .bind("42")
                .first()
            ).payload,
          )
        ).profile,
        undefined,
      );
      assert.equal(
        (
          await unseal(
            secrets,
            "43",
            (
              await db
                .prepare("SELECT payload FROM users WHERE id=?")
                .bind("43")
                .first()
            ).payload,
          )
        ).profile.account,
        "654321",
      );
      assert.equal((await send(43, "/usage_history 2026-09")).status, 200);
      assert.ok(
        calls.some(
          (c) =>
            c.payload.text?.includes("Recharge:") &&
            c.payload.text?.includes("Days:"),
        ),
      );
      const remaining = await db
        .prepare("SELECT payload FROM users WHERE id=?")
        .bind("43")
        .first();
      const state = await unseal(secrets, "43", remaining.payload);
      state.schedule = {
        mode: "daily",
        time: "00:00",
        enabled: Date.now() - 3 * 86400000,
      };
      state.lastRefresh = 0;
      await db
        .prepare("UPDATE users SET payload=?,due=0 WHERE id=?")
        .bind(await seal(secrets, "43", state), "43")
        .run();
      const scheduled = await mf.getWorker();
      const reportCount = () =>
        calls.filter(
          (c) =>
            c.method === "sendMessage" &&
            c.payload.text?.startsWith("<b>📊 Usage:"),
        ).length;
      const reportsBefore = reportCount();
      await scheduled.scheduled({
        cron: "* * * * *",
        scheduledTime: Date.now(),
      });
      assert.equal(reportCount(), reportsBefore + 1);
      secondBalance = "180.00";
      secondReadingTime = dhakaDate() + " 08:00:00";
      addedDailyCost = 5;
      const changed = await unseal(
        secrets,
        "43",
        (
          await db
            .prepare("SELECT payload FROM users WHERE id=?")
            .bind("43")
            .first()
        ).payload,
      );
      changed.lastRefresh = 0;
      await db
        .prepare("UPDATE users SET payload=? WHERE id=?")
        .bind(await seal(secrets, "43", changed), "43")
        .run();
      await db.prepare("UPDATE users SET due=0 WHERE id=?").bind("43").run();
      await scheduled.scheduled({
        cron: "* * * * *",
        scheduledTime: Date.now(),
      });
      const sent = calls.filter(
        (c) => c.method === "sendMessage" && String(c.payload.chat_id) === "43",
      );
      assert.ok(
        sent.some(
          (c) =>
            c.payload.text.includes("<b>📥 New DESCO reading</b>") &&
            c.payload.text.includes("Meter reading:"),
        ),
      );
      assert.ok(
        sent.some((c) =>
          c.payload.text.includes(`Updated ${shift(dhakaDate(), -1)}`),
        ),
      );
      assert.ok(sent.some((c) => c.payload.text.includes("below ৳200.00")));
      assert.ok(sent.every((c) => c.payload.parse_mode === "HTML"));
      const readingCount = sent.filter((c) =>
        c.payload.text.includes("📥 New DESCO reading"),
      ).length;
      await db.prepare("UPDATE users SET due=0 WHERE id=?").bind("43").run();
      await scheduled.scheduled({
        cron: "* * * * *",
        scheduledTime: Date.now(),
      });
      assert.equal(
        calls.filter(
          (c) =>
            c.method === "sendMessage" &&
            c.payload.text?.includes("📥 New DESCO reading"),
        ).length,
        readingCount,
      );
      for (const [balance, hour] of [
        ["600.00", "09"],
        ["450.00", "10"],
        ["280.00", "11"],
      ]) {
        secondBalance = balance;
        secondReadingTime = dhakaDate() + ` ${hour}:00:00`;
        const current = await unseal(
          secrets,
          "43",
          (
            await db
              .prepare("SELECT payload FROM users WHERE id=?")
              .bind("43")
              .first()
          ).payload,
        );
        current.lastRefresh = 0;
        await db
          .prepare("UPDATE users SET payload=?,due=0 WHERE id=?")
          .bind(await seal(secrets, "43", current), "43")
          .run();
        await scheduled.scheduled({
          cron: "* * * * *",
          scheduledTime: Date.now(),
        });
      }
      assert.ok(calls.some((c) => c.payload.text?.includes("below ৳500.00")));
      assert.ok(calls.some((c) => c.payload.text?.includes("below ৳300.00")));
      await send(43, "/language bn");
      await send(43, "/status");
      assert.ok(calls.at(-1).payload.text.includes("ডেসকো হিসাব"));
      await send(43, "/help");
      assert.ok(calls.at(-1).payload.text.includes("বাংলা"));
      assert.equal(String(calls.at(-1).payload.chat_id), "43");
      await db.prepare("UPDATE users SET due=0 WHERE id=?").bind("43").run();
      await scheduled.scheduled({
        cron: "* * * * *",
        scheduledTime: Date.now(),
      });
      assert.equal(reportCount(), reportsBefore + 1);
    } finally {
      await mf.dispose();
    }
  },
);
