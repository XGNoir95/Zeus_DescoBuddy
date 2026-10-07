import test from "node:test";
import assert from "node:assert/strict";
import { dhakaDate, shift } from "../src/finance.js";
import { notifications } from "../src/worker.js";

const usageDay = shift(dhakaDate(), -1);
const readingTime = (date) => `${date} 00:00:00`;

function stateWithNewMidnightBalance() {
  const previous = {
    balance: "3956.10",
    readingTime: readingTime(usageDay),
    meterNo: "M",
    currentMonthConsumption: "100.00",
  };
  const current = {
    balance: "3670.93",
    readingTime: readingTime(shift(usageDay, 1)),
    meterNo: "M",
    currentMonthConsumption: "385.17",
  };
  return {
    profile: { account: "123456", meter: "M" },
    cache: {
      balance: { data: current },
      daily: { data: [] },
      recharges: { data: [] },
    },
    readingSeen: {
      // Existing saved states contain this key but not balanceData.
      balance: JSON.stringify([
        previous.readingTime,
        previous.balance,
        previous.currentMonthConsumption,
      ]),
      days: {},
    },
    seen: {},
    seenInitialized: true,
    alerts: { customLow: null, mismatch: false },
    lowNotified: {},
    pending: {},
    failures: [],
  };
}

function dailyRows(cost) {
  return [
    {
      date: shift(usageDay, -1),
      meterNo: "M",
      consumedUnit: "100",
      consumedTaka: "100",
    },
    {
      date: usageDay,
      meterNo: "M",
      consumedUnit: "133.55",
      consumedTaka: String(100 + cost),
    },
  ];
}

test("new balance gives an early daily estimate, later matching kWh is silent", () => {
  const state = stateWithNewMidnightBalance();
  const first = notifications(state);
  assert.equal(first.length, 1);
  assert.match(first[0].text, /about ৳285\.17 spent/);
  assert.match(first[0].text, /Balance: ৳3670\.93/);
  assert.match(first[0].text, /Meter reading:/);
  state.cache.daily.data = dailyRows(285.17);
  assert.deepEqual(notifications(state), []);
  assert.deepEqual(notifications(state), []);
});

test("a real daily-cost mismatch triggers one caution, not a duplicate reading", () => {
  const state = stateWithNewMidnightBalance();
  notifications(state);
  state.cache.daily.data = dailyRows(290);
  const later = notifications(state);
  assert.equal(later.length, 1);
  assert.match(later[0].text, /Cost difference/);
  assert.match(later[0].text, /৳4\.83/);
  assert.doesNotMatch(later[0].text, /New DESCO reading/);
  assert.deepEqual(notifications(state), []);
});

test("when DESCO daily kWh is already ready, one reading shows actual cost", () => {
  const state = stateWithNewMidnightBalance();
  state.cache.daily.data = dailyRows(285.17);
  const messages = notifications(state);
  assert.equal(messages.length, 1);
  assert.match(messages[0].text, /33\.55 kWh/);
  assert.doesNotMatch(messages[0].text, /about/);
  assert.deepEqual(notifications(state), []);
});

test("new balance already covers the post-recharge balance notice", () => {
  const state = stateWithNewMidnightBalance();
  const receipt = {
    orderID: "R1",
    rechargeDate: `${usageDay} 12:00:00`,
    orderStatus: "Successful",
    energyAmount: "100.00",
    meterNo: "M",
  };
  state.cache.recharges.data = [receipt];
  state.seen.R1 = JSON.stringify(receipt);
  state.pending.R1 = receipt;
  const messages = notifications(state);
  assert.equal(messages.length, 1);
  assert.match(messages[0].text, /Recharge credit added: ৳100\.00/);
  assert.equal(state.pending.R1, undefined);
});
