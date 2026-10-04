import { normalizeReceipt, num, shift } from "./finance.js";
const BASE = "https://prepaid.desco.org.bd/api";
export class SourceError extends Error {}
export async function request(system, endpoint, account, params = {}) {
  if (!["unified", "tkdes"].includes(system))
    throw new SourceError("Unknown meter system.");
  const url = new URL(`${BASE}/${system}/customer/${endpoint}`);
  url.search = new URLSearchParams({
    accountNo: account,
    ...params,
  }).toString();
  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(12000),
    });
    if (!response.ok)
      throw new SourceError(
        `DESCO returned HTTP ${response.status}. Please retry.`,
      );
    const body = await response.json();
    if (String(body.code) === "16001") return null;
    if (String(body.code) !== "200")
      throw new SourceError("DESCO could not provide this record.");
    return body.data;
  } catch (e) {
    if (e instanceof SourceError) throw e;
    throw new SourceError(
      "Cannot reach DESCO securely right now. Please retry.",
    );
  }
}
export async function balance(p) {
  const data = await request(p.system, "getBalance", p.account, {
    meterNo: p.meter,
  });
  if (
    !data ||
    num(data.balance) === null ||
    (data.accountNo && String(data.accountNo) !== p.account) ||
    (data.meterNo && String(data.meterNo) !== p.meter)
  )
    throw new SourceError("No matching balance reading received.");
  return Object.fromEntries(
    [
      "accountNo",
      "meterNo",
      "balance",
      "currentMonthConsumption",
      "readingTime",
    ]
      .filter((k) => k in data)
      .map((k) => [k, data[k]]),
  );
}
export async function discover(account, meter) {
  for (const system of ["unified", "tkdes"]) {
    try {
      const info = await request(system, "getCustomerInfo", account, {
        meterNo: meter,
      });
      if (
        !info ||
        String(info.accountNo) !== account ||
        String(info.meterNo) !== meter
      )
        continue;
      return {
        account,
        meter,
        system,
        category: String(info.tariffSolution || ""),
      };
    } catch (e) {
      if (!(e instanceof SourceError)) throw e;
    }
  }
  throw new SourceError(
    "Could not confirm that account and meter pair. Check both numbers or retry later.",
  );
}
export async function daily(p, start, end) {
  const rows = [];
  for (let from = start; from <= end; from = shift(from, 15)) {
    const to = shift(from, 14) < end ? shift(from, 14) : end;
    const data = await request(
      p.system,
      "getCustomerDailyConsumption",
      p.account,
      { meterNo: p.meter, dateFrom: from, dateTo: to },
    );
    if (
      !Array.isArray(data) ||
      data.some(
        (r) =>
          !r ||
          typeof r !== "object" ||
          (r.meterNo && String(r.meterNo) !== p.meter),
      )
    )
      throw new SourceError("Daily readings are temporarily missing.");
    rows.push(
      ...data.map((r) =>
        Object.fromEntries(
          ["date", "meterNo", "consumedUnit", "consumedTaka"]
            .filter((k) => k in r)
            .map((k) => [k, r[k]]),
        ),
      ),
    );
  }
  return rows;
}
export async function recharges(p, start, end) {
  const data = await request(p.system, "getRechargeHistory", p.account, {
    meterNo: p.meter,
    dateFrom: start,
    dateTo: end,
  });
  if (
    !Array.isArray(data) ||
    data.some(
      (r) =>
        !r ||
        typeof r !== "object" ||
        (r.meterNo && String(r.meterNo) !== p.meter),
    )
  )
    throw new SourceError("Recharge history is temporarily missing.");
  return data.map(normalizeReceipt);
}
