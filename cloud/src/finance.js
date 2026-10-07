import Decimal from "decimal.js";

export function num(value) {
  if (
    value === null ||
    value === undefined ||
    typeof value === "boolean" ||
    value === ""
  )
    return null;
  try {
    const n = new Decimal(String(value).replaceAll(",", ""));
    return n.isFinite() ? n : null;
  } catch {
    return null;
  }
}
export const money = (value) => {
  const n = num(value);
  return n === null ? "Pending" : `৳${n.toFixed(2)}`;
};
export const dateOf = (value) =>
  /^\d{4}-\d{2}-\d{2}/.test(String(value)) ? String(value).slice(0, 10) : null;
export function instant(value) {
  if (!value) return null;
  const text = String(value).replace(" ", "T");
  const ms = Date.parse(
    /[zZ]|[+-]\d{2}:?\d{2}$/.test(text) ? text : `${text}+06:00`,
  );
  return Number.isFinite(ms) ? ms : null;
}
export const dhakaDate = (ms = Date.now()) =>
  new Date(ms + 21600000).toISOString().slice(0, 10);
export const shift = (date, days) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000)
    .toISOString()
    .slice(0, 10);
export function monthRange(month, now = Date.now()) {
  if (
    !/^\d{4}-\d{2}$/.test(month) ||
    +month.slice(5) < 1 ||
    +month.slice(5) > 12
  )
    throw new Error("Use /usage_history YYYY-MM.");
  const start = `${month}-01`;
  if (start > dhakaDate(now))
    throw new Error("Choose this month or an earlier month.");
  const end = new Date(Date.UTC(+month.slice(0, 4), +month.slice(5), 0))
    .toISOString()
    .slice(0, 10);
  return [start, end < dhakaDate(now) ? end : dhakaDate(now)];
}
export function dailyDeltas(rows = []) {
  const dates = new Map(),
    conflicts = new Set();
  for (const row of rows) {
    const d = dateOf(row.date);
    if (!d) continue;
    if (dates.has(d) && JSON.stringify(dates.get(d)) !== JSON.stringify(row))
      conflicts.add(d);
    dates.set(d, row);
  }
  return [...dates.keys()].sort().map((date) => {
    const row = dates.get(date),
      prev = dates.get(shift(date, -1));
    const out = { date, units: null, cost: null };
    if (
      !prev ||
      conflicts.has(date) ||
      conflicts.has(shift(date, -1)) ||
      (prev.meterNo && row.meterNo !== prev.meterNo)
    )
      return out;
    const u = num(row.consumedUnit),
      pu = num(prev.consumedUnit),
      c = num(row.consumedTaka),
      pc = num(prev.consumedTaka);
    if (u !== null && pu !== null && u.gte(pu))
      out.units = u.minus(pu).toString();
    if (
      c !== null &&
      c.gte(0) &&
      (date.endsWith("-01") || (pc !== null && c.gte(pc)))
    )
      out.cost = (date.endsWith("-01") ? c : c.minus(pc)).toString();
    return out;
  });
}
export function normalizeReceipt(row) {
  const keys = [
    "orderID",
    "rechargeDate",
    "totalAmount",
    "energyAmount",
    "chargeAmount",
    "VAT",
    "rebate",
    "orderStatus",
    "meterNo",
  ];
  const out = Object.fromEntries(
    keys.filter((k) => k in row).map((k) => [k, row[k]]),
  );
  if (Array.isArray(row.chargeItems))
    out.chargeItems = row.chargeItems.map((item) => ({
      name: item.name ?? item.chargeItemName ?? null,
      value: item.value ?? item.chargeAmount ?? null,
    }));
  return out;
}
export function auditReceipt(row) {
  const gross = num(row.totalAmount),
    energy = num(row.energyAmount),
    vat = num(row.VAT),
    rebate = num(row.rebate);
  let charges = num(row.chargeAmount),
    details = null;
  if (
    Array.isArray(row.chargeItems) &&
    row.chargeItems.every(
      (i) =>
        num(i.value) !== null &&
        !["vat", "rebate"].includes(String(i.name).trim().toLowerCase()),
    )
  ) {
    details = row.chargeItems.reduce(
      (sum, i) => sum.plus(num(i.value)),
      new Decimal(0),
    );
  }
  charges ??= details;
  if (
    [gross, energy, vat, rebate, charges].some((n) => n === null) ||
    gross.lt(0) ||
    energy.lt(0) ||
    charges.lt(0)
  )
    return { state: "pending" };
  if (details !== null && details.minus(charges).abs().gt("0.01"))
    return {
      state: "difference",
      difference: charges.minus(details).toString(),
    };
  const difference = gross.minus(energy.plus(vat).plus(rebate).plus(charges));
  return {
    state: difference.abs().lte("0.01") ? "matched" : "difference",
    difference: difference.toString(),
  };
}
export function auditBalance(state) {
  const p = state.previousBalance,
    c = state.cache?.balance?.data;
  if (
    !p ||
    !c ||
    state.failures?.some((k) => ["balance", "recharges"].includes(k))
  )
    return "Balance check: waiting for two fresh readings.";
  const before = instant(p.readingTime),
    after = instant(c.readingTime);
  if (
    !before ||
    !after ||
    after <= before ||
    dhakaDate(before).slice(0, 7) !== dhakaDate(after).slice(0, 7) ||
    p.meterNo !== c.meterNo ||
    before < Date.now() - 35 * 86400000
  )
    return "Balance check: readings cannot be compared yet.";
  if (
    (state.cache?.recharges?.data || []).some(
      (r) =>
        !instant(r.rechargeDate) ||
        (instant(r.rechargeDate) >= before - 2 * 86400000 &&
          instant(r.rechargeDate) <= after + 2 * 86400000),
    )
  )
    return "Balance check: waiting for readings clear of the recharge period.";
  const values = [
    p.balance,
    c.balance,
    p.currentMonthConsumption,
    c.currentMonthConsumption,
  ].map(num);
  if (values.some((v) => v === null) || values[3].lt(values[2]))
    return "Balance check: missing or corrected readings.";
  const difference = values[0]
    .minus(values[1])
    .minus(values[3].minus(values[2]));
  return difference.abs().lte("0.01")
    ? "Balance change matches DESCO’s reported cost."
    : `⚠️ Balance/cost difference: ${money(difference)}. Timing or missing adjustments may explain this; needs checking.`;
}
// A midnight balance is a snapshot, not a tariff ledger. This is only an
// estimate for one complete day; the daily DESCO record remains authoritative.
export function balanceDayEstimate(previous, current, receipts, freshReceipts) {
  const before = instant(previous?.readingTime),
    after = instant(current?.readingTime),
    previousDay = dateOf(previous?.readingTime),
    currentDay = dateOf(current?.readingTime),
    oldBalance = num(previous?.balance),
    newBalance = num(current?.balance);
  if (
    !freshReceipts ||
    !Array.isArray(receipts) ||
    !before ||
    !after ||
    !previousDay ||
    currentDay !== shift(previousDay, 1) ||
    before !== instant(`${previousDay} 00:00:00`) ||
    after !== instant(`${currentDay} 00:00:00`) ||
    oldBalance === null ||
    newBalance === null ||
    (previous.meterNo &&
      current.meterNo &&
      previous.meterNo !== current.meterNo)
  )
    return null;
  let credit = new Decimal(0);
  const seen = new Set();
  for (const receipt of receipts) {
    const when = instant(receipt.rechargeDate);
    if (!when) return null;
    if (when <= before || when >= after) continue;
    const amount = num(receipt.energyAmount);
    if (
      !receipt.orderID ||
      seen.has(String(receipt.orderID)) ||
      receipt.orderStatus !== "Successful" ||
      amount === null ||
      amount.lt(0) ||
      (receipt.meterNo &&
        current.meterNo &&
        receipt.meterNo !== current.meterNo)
    )
      return null;
    seen.add(String(receipt.orderID));
    credit = credit.plus(amount);
  }
  const cost = oldBalance.plus(credit).minus(newBalance);
  if (cost.lt(0)) return null;
  return {
    date: previousDay,
    cost: cost.toFixed(2),
    credit: credit.toFixed(2),
  };
}
export function costLine(row = {}) {
  const u = num(row.units),
    c = num(row.cost);
  if (u === null || c === null) return "Waiting for DESCO";
  return u.isZero()
    ? `0 kWh · ${money(c)}`
    : `${u} kWh × ৳${c.div(u).toFixed(4)} ≈ ${money(c)}`;
}
export function latestLine(rows, today) {
  const row = rows
    .filter((r) => r.date < today && r.units !== null && r.cost !== null)
    .sort((a, b) => a.date.localeCompare(b.date))
    .at(-1);
  return row
    ? `Latest day (${row.date}): ${costLine(row)}`
    : "No complete daily reading yet.";
}
export function statusReport(state) {
  const b = state.cache?.balance?.data || {},
    rows = dailyDeltas(state.cache?.daily?.data);
  const today = dhakaDate(),
    row = rows.find((r) => r.date === today);
  const lines = [
    "⚡ DESCO status",
    `Account: ••••${state.profile.account.slice(-4)}`,
    `Balance: ${money(b.balance)}`,
    `Spent this month: ${money(b.currentMonthConsumption)}`,
    `DESCO updated: ${b.readingTime || "Pending"} Dhaka`,
  ];
  lines.push(
    row?.cost != null && row?.units != null
      ? `Today so far: ${costLine(row)}`
      : `Today's reading is pending.\n${latestLine(rows, today)}`,
  );
  lines.push("Price/kWh is the day's average.");
  if (state.cache?.daily?.at)
    lines.push(
      `Usage checked: ${new Date(state.cache.daily.at + 21600000).toISOString().slice(0, 16).replace("T", " ")} Dhaka`,
    );
  if (state.failures?.length)
    lines.push(
      `⚠️ Refresh failed: ${state.failures.join(", ")}. Saved readings shown.`,
    );
  return lines.join("\n");
}
export function periodReport(state, start, end) {
  const rows = dailyDeltas(state.cache?.daily?.data),
    byDate = new Map(rows.map((r) => [r.date, r]));
  const lines = [`📊 Usage: ${start} → ${end}`];
  let total = new Decimal(0),
    count = 0,
    days = 0;
  for (let d = start; d <= end; d = shift(d, 1)) {
    const r = byDate.get(d);
    lines.push(`${d}: ${costLine(r)}`);
    days++;
    if (r?.cost != null && r?.units != null) {
      total = total.plus(r.cost);
      count++;
    }
  }
  lines.push(
    `Days received: ${count}/${days}`,
    `Cost for available days: ${count ? money(total) : "Pending"}`,
  );
  if (!count || !byDate.get(dhakaDate())?.cost)
    lines.push(latestLine(rows, dhakaDate()));
  lines.push("Price/kWh is the day's average. Today's total can change.");
  if (state.failures?.includes("daily"))
    lines.push("⚠️ Using saved daily readings; refresh failed.");
  return lines.join("\n");
}
export function receiptReport(row, balance, recharges) {
  const lines = [
    "💳 Recharge",
    `Date: ${row.rechargeDate}`,
    `Status: ${row.orderStatus || "Pending"}`,
    `Paid: ${money(row.totalAmount)}`,
    `Electricity credit: ${money(row.energyAmount)}`,
    `VAT: ${money(row.VAT)}`,
    `Rebate: ${money(row.rebate)}`,
  ];
  for (const i of row.chargeItems || [])
    lines.push(`${i.name || "Charge"}: ${money(i.value)}`);
  if (row.chargeAmount != null)
    lines.push(`Other charges total: ${money(row.chargeAmount)}`);
  const g = num(row.totalAmount),
    e = num(row.energyAmount);
  if (g !== null && e !== null) lines.push(`Deduction: ${money(g.minus(e))}`);
  const audit = auditReceipt(row);
  lines.push(
    audit.state === "matched"
      ? "✅ Receipt amounts add up."
      : audit.state === "difference"
        ? `⚠️ Receipt difference: ${money(audit.difference)}`
        : "Receipt check pending: missing details.",
  );
  if (balance) {
    lines.push(
      `Latest balance: ${money(balance.balance)}`,
      `Reading: ${balance.readingTime || "Pending"} Dhaka`,
    );
    const bt = instant(balance.readingTime),
      rd = instant(row.rechargeDate);
    if (!bt || !rd || bt < rd) {
      lines.push("⏳ Waiting for a reading after this recharge.");
      const later = (recharges || []).filter(
        (r) =>
          instant(r.rechargeDate) > bt && instant(r.rechargeDate) <= Date.now(),
      );
      if (
        bt &&
        bt > Date.now() - 34 * 86400000 &&
        recharges &&
        num(balance.balance) !== null &&
        later.length &&
        new Set(later.map((r) => r.orderID)).size === later.length &&
        later.every(
          (r) =>
            r.orderID &&
            r.orderStatus === "Successful" &&
            r.meterNo === balance.meterNo &&
            num(r.energyAmount)?.gte(0),
        )
      ) {
        const credits = later.reduce(
          (sum, r) => sum.plus(r.energyAmount),
          new Decimal(0),
        );
        lines.push(
          `Balance + credits: ${money(num(balance.balance).plus(credits))}`,
          "Estimate before later usage/fees; assumes credits reached the meter.",
        );
      }
    }
  }
  return lines.join("\n");
}
export function historyReport(daily, receipts, start, end) {
  const byDate = new Map(dailyDeltas(daily).map((r) => [r.date, r])),
    groups = new Map();
  for (const r of receipts) {
    const d = dateOf(r.rechargeDate);
    if (d >= start && d <= end && r.orderStatus === "Successful")
      groups.set(d, [...(groups.get(d) || []), r]);
  }
  const boundaries = [...new Set([start, ...groups.keys()])].sort(),
    lines = [`📒 Usage history — ${start.slice(0, 7)}`];
  for (let i = 0; i < boundaries.length; i++) {
    const begin = boundaries[i],
      finish = boundaries[i + 1] ? shift(boundaries[i + 1], -1) : end;
    lines.push("");
    if (!groups.has(begin))
      lines.push(
        "Recharge: none yet this month (earlier balance may carry over).",
      );
    for (const r of groups.get(begin) || []) {
      const gross = num(r.totalAmount),
        credit = num(r.energyAmount);
      lines.push(
        `Recharge: ${r.rechargeDate} · ${money(gross)}`,
        `Deduction: ${gross !== null && credit !== null ? money(gross.minus(credit)) : "Pending"} · Electricity credit: ${money(credit)}`,
        `VAT ${money(r.VAT)} · Rebate ${money(r.rebate)}`,
      );
      for (const item of r.chargeItems || [])
        lines.push(`${item.name || "Charge"}: ${money(item.value)}`);
      if (r.chargeAmount != null)
        lines.push(`Other charges total: ${money(r.chargeAmount)}`);
      if (auditReceipt(r).state !== "matched")
        lines.push("⚠️ Receipt needs checking.");
    }
    lines.push("Days:");
    let total = new Decimal(0),
      count = 0;
    for (let d = begin; d <= finish; d = shift(d, 1)) {
      const row = byDate.get(d);
      lines.push(`${d}: ${costLine(row)}`);
      if (row?.cost != null && row?.units != null) {
        total = total.plus(row.cost);
        count++;
      }
    }
    lines.push(`Cost for available days: ${count ? money(total) : "Pending"}`);
  }
  for (const r of receipts.filter((r) => r.orderStatus !== "Successful"))
    lines.push(
      `Other attempt: ${r.rechargeDate} · ${money(r.totalAmount)} · ${r.orderStatus || "Pending"}`,
    );
  lines.push(
    "Price/kWh is the day's average. Recharge-day usage includes time before payment. Same-day recharges share one daily group. Groups don't prove which credit paid for each day's usage.",
  );
  return lines.join("\n");
}
