import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import {
  auditReceipt,
  balanceDayEstimate,
  costLine,
  dailyDeltas,
  historyReport,
  normalizeReceipt,
  monthRange,
} from "../src/finance.js";
import { seal, unseal, chunks } from "../src/store.js";
import { privateUser, scheduleSlot } from "../src/worker.js";

test("tkdes deductions reconcile exactly and sensitive fields are removed", () => {
  const row = normalizeReceipt({
    totalAmount: 5000,
    energyAmount: 4493.39,
    VAT: 238.1,
    rebate: -23.49,
    tokenNo: "SECRET",
    customerName: "PRIVATE",
    chargeItems: [
      { chargeItemName: "Demand", chargeAmount: 252 },
      { chargeItemName: "Rent", chargeAmount: 40 },
    ],
  });
  assert.equal(auditReceipt(row).state, "matched");
  assert.equal(row.tokenNo, undefined);
  assert.equal(row.customerName, undefined);
  row.chargeAmount = 300;
  assert.equal(auditReceipt(row).state, "difference");
});
test("daily counters preserve gaps, monthly resets, zero usage and meter changes", () => {
  const rows = [
    {
      date: "2026-09-30",
      consumedUnit: "100",
      consumedTaka: "800",
      meterNo: "A",
    },
    {
      date: "2026-10-01",
      consumedUnit: "110",
      consumedTaka: "60",
      meterNo: "A",
    },
    {
      date: "2026-10-02",
      consumedUnit: "110",
      consumedTaka: "60",
      meterNo: "A",
    },
    {
      date: "2026-10-04",
      consumedUnit: "140",
      consumedTaka: "240",
      meterNo: "A",
    },
    {
      date: "2026-10-05",
      consumedUnit: "150",
      consumedTaka: "300",
      meterNo: "B",
    },
  ];
  const deltas = dailyDeltas(rows);
  assert.equal(deltas[1].cost, "60");
  assert.equal(deltas[2].units, "0");
  assert.equal(deltas[3].cost, null);
  assert.equal(deltas[4].cost, null);
  assert.equal(costLine(deltas[1]), "10 kWh × ৳6.0000 ≈ ৳60.00");
});
test("midnight balance change estimates one day and uses net recharge credit", () => {
  const previous = {
    readingTime: "2026-10-06 00:00:00",
    balance: "3956.10",
    meterNo: "M",
  };
  const current = {
    readingTime: "2026-10-07 00:00:00",
    balance: "3670.93",
    meterNo: "M",
  };
  assert.deepEqual(balanceDayEstimate(previous, current, [], true), {
    date: "2026-10-06",
    cost: "285.17",
    credit: "0.00",
  });
  assert.deepEqual(
    balanceDayEstimate(
      previous,
      current,
      [
        {
          orderID: "1",
          rechargeDate: "2026-10-06 12:00:00",
          orderStatus: "Successful",
          energyAmount: "4493.39",
          meterNo: "M",
        },
      ],
      true,
    ),
    { date: "2026-10-06", cost: "4778.56", credit: "4493.39" },
  );
  assert.equal(balanceDayEstimate(previous, current, [], false), null);
  assert.equal(
    balanceDayEstimate(
      previous,
      { ...current, readingTime: "2026-10-08 00:00:00" },
      [],
      true,
    ),
    null,
  );
  assert.equal(
    balanceDayEstimate(previous, { ...current, meterNo: "OTHER" }, [], true),
    null,
  );
  assert.equal(
    balanceDayEstimate(
      previous,
      current,
      [
        {
          orderID: "2",
          rechargeDate: "2026-10-06 12:00:00",
          orderStatus: "Pending",
          energyAmount: "100",
        },
      ],
      true,
    ),
    null,
  );
});
test("same-day multiple recharges do not duplicate daily costs", () => {
  const r = {
    totalAmount: "500",
    energyAmount: "450",
    VAT: "25",
    rebate: "-5",
    chargeItems: [{ name: "Rent", value: "30" }],
    orderStatus: "Successful",
  };
  const receipts = [
    { ...r, rechargeDate: "2026-09-02 09:00:00" },
    { ...r, rechargeDate: "2026-09-02 17:00:00" },
    { ...r, rechargeDate: "2026-09-04 09:00:00" },
  ];
  const daily = Array.from({ length: 4 }, (_, i) => ({
    date: `2026-09-0${i + 1}`,
    consumedUnit: 100 + (i + 1) * 10,
    consumedTaka: (i + 1) * 60,
  }));
  const text = historyReport(daily, receipts, "2026-09-01", "2026-09-05");
  assert.equal(text.match(/Deduction: ৳50.00/g).length, 3);
  assert.equal(text.match(/2026-09-02: 10 kWh/g).length, 1);
  assert.match(text, /2026-09-05: Waiting/);
});
test("encryption is tied to user identity", async () => {
  const env = { DATA_KEY: randomBytes(32).toString("base64") };
  const encrypted = await seal(env, "42", { account: "PRIVATE" });
  assert.ok(!encrypted.includes("PRIVATE"));
  assert.deepEqual(await unseal(env, "42", encrypted), { account: "PRIVATE" });
  await assert.rejects(unseal(env, "43", encrypted));
});
test("only matching private user/chat identities are accepted", () => {
  assert.equal(
    privateUser({
      message: { from: { id: 42 }, chat: { id: 42, type: "private" } },
    }),
    "42",
  );
  assert.equal(
    privateUser({
      callback_query: {
        from: { id: 42 },
        message: { chat: { id: 43, type: "private" } },
      },
    }),
    null,
  );
  assert.equal(
    privateUser({
      message: { from: { id: 42 }, chat: { id: 42, type: "group" } },
    }),
    null,
  );
});
test("weekly schedules use Bangladesh time and month validation is strict", () => {
  assert.equal(
    scheduleSlot(
      { mode: "weekly", weekday: 5, time: "20:00" },
      Date.parse("2026-10-04T10:00:00Z"),
    ),
    "2026-10-02T20:00+06:00",
  );
  assert.throws(() => monthRange("2026-13"));
  assert.throws(() => monthRange("2999-01"));
  assert.deepEqual(monthRange("2026-09", Date.parse("2026-10-04T00:00:00Z")), [
    "2026-09-01",
    "2026-09-30",
  ]);
  assert.ok(chunks("x".repeat(10000)).every((c) => c.length <= 3500));
});
