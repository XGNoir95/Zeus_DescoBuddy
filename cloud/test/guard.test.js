import test from "node:test";
import assert from "node:assert/strict";
import {
  allowUpdate,
  BodyTooLarge,
  isExpensive,
  readUpdate,
} from "../src/guard.js";
import { ensureUser } from "../src/store.js";

test("bounded webhook reader rejects a chunked body over 64 KiB", async () => {
  const request = new Request("https://example.test/telegram", {
    method: "POST",
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(40000));
        controller.enqueue(new Uint8Array(26000));
        controller.close();
      },
    }),
    duplex: "half",
  });
  await assert.rejects(readUpdate(request), BodyTooLarge);
  assert.equal(
    await readUpdate(
      new Request("https://example.test/telegram", {
        method: "POST",
        body: '{"update_id":1}',
      }),
    ),
    '{"update_id":1}',
  );
});

test("rate guard spends the expensive budget only on costly commands", async () => {
  const seen = [];
  const env = {
    USER_UPDATES: {
      async limit({ key }) {
        seen.push(`user:${key}`);
        return { success: seen.filter((s) => s === `user:${key}`).length <= 2 };
      },
    },
    EXPENSIVE_UPDATES: {
      async limit({ key }) {
        seen.push(`expensive:${key}`);
        return { success: false };
      },
    },
  };
  const status = { message: { text: "/status" } };
  const history = { message: { text: "/usage_history 2026-10" } };
  assert.equal(isExpensive(history), true);
  assert.equal(isExpensive(status), false);
  assert.equal(await allowUpdate(env, "42", status), true);
  assert.equal(await allowUpdate(env, "42", history), false);
  assert.equal(await allowUpdate(env, "42", status), false);
  assert.deepEqual(seen, ["user:42", "user:42", "expensive:42", "user:42"]);
});

test("onboarding rejects new users before encryption or insertion", async () => {
  const queries = [];
  const env = {
    DB: {
      prepare(sql) {
        queries.push(sql);
        return {
          bind() {
            return { first: async () => null };
          },
        };
      },
    },
    ONBOARDING: {
      async limit({ key }) {
        assert.equal(key, "new-user");
        return { success: false };
      },
    },
  };
  assert.equal(await ensureUser(env, "42"), "limited");
  assert.equal(queries.length, 1);
  assert.match(queries[0], /^SELECT id FROM users/);
});
