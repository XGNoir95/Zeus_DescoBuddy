from datetime import datetime, timedelta
from decimal import Decimal

from .accounting import DHAKA, daily_deltas, day, instant, money, number, receipt_audit


def masked(account):
    return "••••" + str(account)[-4:]


def cost_line(row):
    units, cost = number(row.get("units")), number(row.get("cost"))
    if units is None or cost is None:
        return "Waiting for DESCO's reading"
    if units == 0:
        return f"0 kWh · {money(cost)}"
    return f"{units.normalize():f} kWh × ৳{cost / units:.4f} ≈ {money(cost)}"


def latest_cost(rows, before):
    valid = [
        r
        for r in rows
        if day(r["date"]) < before and r.get("units") is not None and r.get("cost") is not None
    ]
    if not valid:
        return "No daily cost received yet."
    row = max(valid, key=lambda r: r["date"])
    return f"Latest day ({day(row['date']):%d %b}): {cost_line(row)}"


def checked_line(bundle):
    fetched = instant(bundle.get("fetched", {}).get("daily"))
    return f"Usage checked: {fetched:%d %b, %H:%M} Dhaka" if fetched else ""


def status(bundle, stale_hours=24):
    balance = bundle.get("balance") or {}
    now = datetime.now(DHAKA)
    ts = instant(balance.get("readingTime"))
    stamp = ts.strftime("%d %b %Y, %H:%M Dhaka") if ts else "Unavailable"
    daily = {r["date"]: r for r in daily_deltas(bundle.get("daily", []))}
    today = daily.get(now.date().isoformat(), {})
    lines = [
        "⚡ DESCO status",
        f"Account: {masked(bundle.get('account', ''))}",
        f"Balance: {money(balance.get('balance'))}",
        f"Spent this month: {money(balance.get('currentMonthConsumption'))}",
        f"DESCO updated: {stamp}",
    ]
    if ts and ts > now + timedelta(minutes=5):
        lines.append("⚠️ DESCO's reading date looks incorrect.")
    elif ts and now - ts > timedelta(hours=stale_hours):
        lines.append("⚠️ Balance reading is over a day old.")
    if today.get("cost") is not None and today.get("units") is not None:
        lines.append(f"Today so far: {cost_line(today)}")
    else:
        lines.append("Today's reading is pending.")
        lines.append(latest_cost(list(daily.values()), now.date()))
    lines.append("Price/kWh is the day's average, rounded.")
    if checked_line(bundle):
        lines.append(checked_line(bundle))
    for key in bundle.get("cached", {}):
        lines.append(f"⚠️ {key}: using saved data; refresh failed.")
    for key in bundle.get("unavailable", []):
        lines.append(f"⚠️ {key}: unavailable.")
    if "recharges" not in bundle.get("cached", {}) and "recharges" not in bundle.get("unavailable", []):
        lines.extend(recharge_projection(balance, bundle.get("recharges")))
    return "\n".join(lines)


def period(bundle, start, end):
    rows = {r["date"]: r for r in daily_deltas(bundle.get("daily", []))}
    lines = [f"📊 Usage: {start:%d %b} → {end:%d %b}"]
    units, cost = Decimal(0), Decimal(0)
    available = 0
    count = (end - start).days + 1
    for i in range(count):
        d = start + timedelta(days=i)
        r = rows.get(d.isoformat(), {})
        u, c = number(r.get("units")), number(r.get("cost"))
        lines.append(f"{d:%d %b}: {cost_line(r)}")
        if u is not None and c is not None:
            units += u
            cost += c
            available += 1
    lines.append(f"Days received: {available}/{count}")
    if available:
        lines.append(
            f"{'Total' if available == count else 'Total for available days'}: {units} kWh · {money(cost)}"
        )
    else:
        lines.append("Total pending.")
    if not available or (
        end >= datetime.now(DHAKA).date()
        and (
            rows.get(datetime.now(DHAKA).date().isoformat(), {}).get("cost") is None
            or rows.get(datetime.now(DHAKA).date().isoformat(), {}).get("units") is None
        )
    ):
        lines.append(
            latest_cost(list(rows.values()), min(end + timedelta(days=1), datetime.now(DHAKA).date()))
        )
    lines.append("Price/kWh is the day's average, rounded.")
    if checked_line(bundle):
        lines.append(checked_line(bundle))
    if end >= datetime.now(DHAKA).date():
        lines.append("Today's total may change when DESCO updates.")
    if "daily" in bundle.get("cached", {}) or "daily" in bundle.get("unavailable", []):
        lines.append("⚠️ Refresh failed; showing saved readings.")
    return "\n".join(lines)


def usage_history(bundle, start, end):
    """Calendar groups, not an assertion that daily spending belongs to a credit."""
    rows = {r["date"]: r for r in daily_deltas(bundle.get("daily", []))}
    groups = {}
    other = []
    for r in bundle.get("recharges", []):
        d = day(r.get("rechargeDate"))
        if not d or not start <= d <= end:
            continue
        if str(r.get("orderStatus", "")).lower() == "successful":
            groups.setdefault(d, []).append(r)
        else:
            other.append(r)
    boundaries = sorted({start, *groups})
    lines = [f"📒 Usage history — {start:%B %Y}"]
    for idx, begin in enumerate(boundaries):
        finish = boundaries[idx + 1] - timedelta(days=1) if idx + 1 < len(boundaries) else end
        lines.append("")
        if begin in groups:
            for r in sorted(groups[begin], key=lambda v: str(v.get("rechargeDate", ""))):
                gross, credit = number(r.get("totalAmount")), number(r.get("energyAmount"))
                lines.append(f"Recharge: {r.get('rechargeDate')} · {money(gross)}")
                deductions = gross - credit if gross is not None and credit is not None else None
                lines.append(f"Deduction: {money(deductions)} · Electricity credit: {money(credit)}")
                parts = [f"VAT {money(r.get('VAT'))}"]
                parts.extend(
                    f"{i.get('name') or 'Charge'} {money(i.get('value'))}"
                    for i in (r.get("chargeItems") or [])
                )
                if not r.get("chargeItems") and r.get("chargeAmount") is not None:
                    parts.append(f"Other charges {money(r['chargeAmount'])}")
                parts.append(f"Rebate {money(r.get('rebate'))}")
                lines.append(" · ".join(parts))
                if receipt_audit(r)["state"] != "matched":
                    lines.append("⚠️ Receipt needs checking; /audit for details.")
        else:
            lines.append("Recharge: no recharge yet this month (earlier balance may carry over).")
        lines.append("Days:")
        subtotal = Decimal(0)
        complete = 0
        for offset in range((finish - begin).days + 1):
            d = begin + timedelta(days=offset)
            r = rows.get(d.isoformat(), {})
            lines.append(f"{d:%d %b}: {cost_line(r)}")
            if r.get("cost") is not None and r.get("units") is not None:
                subtotal += number(r["cost"])
                complete += 1
        lines.append(
            f"Cost for available days: {money(subtotal) if complete else 'Pending'} ({complete}/{(finish - begin).days + 1} days)"
        )
    if other:
        lines.append("Other recharge attempts (not counted as credit):")
        for r in other:
            lines.append(
                f"{r.get('rechargeDate')}: {money(r.get('totalAmount'))} · {r.get('orderStatus') or 'Status missing'}"
            )
    lines.append(
        "Price/kWh is the day's average. Recharge-day usage covers the whole day, including before payment. Same-day recharges share one daily group."
    )
    lines.append(
        "Electricity credit is from the receipt; groups do not prove which recharge paid for each day's usage."
    )
    return "\n".join(lines)


def receipt(row, balance=None, new=False, recharges=None):
    lines = [
        "💳 New recharge detected" if new else "💳 Recharge details",
        f"Date: {row.get('rechargeDate', 'Unavailable')}",
        f"DESCO status: {str(row.get('orderStatus', 'Unavailable'))[:100]}",
        f"Paid to DESCO: {money(row.get('totalAmount'))}",
        f"Electricity credit: {money(row.get('energyAmount'))}",
        f"VAT: {money(row.get('VAT'))}",
        f"Rebate: {money(row.get('rebate'))}",
    ]
    for item in (row.get("chargeItems") or [])[:15]:
        lines.append(f"{str(item.get('name', 'Charge'))[:80]}: {money(item.get('value'))}")
    if row.get("chargeAmount") is not None:
        lines.append(f"Other charges total (not additional to above items): {money(row['chargeAmount'])}")
    audit = receipt_audit(row)
    if audit["state"] == "matched":
        lines.append(
            f"Total deductions after rebate: {money(number(row['totalAmount']) - number(row['energyAmount']))}"
        )
        lines.append("✅ Receipt amounts add up.")
    elif audit["state"] == "discrepancy":
        lines.append(f"⚠️ Receipt difference: {money(audit['difference'])}. {audit['reason']}; needs review.")
    else:
        lines.append("Receipt check pending: some details are missing.")
    if balance:
        lines += [
            f"Latest reported balance: {money(balance.get('balance'))}",
            f"DESCO reading: {balance.get('readingTime') or 'Unavailable'}",
        ]
        rd, bt = instant(row.get("rechargeDate")), instant(balance.get("readingTime"))
        if not rd or not bt or bt < rd:
            lines.append("⏳ Waiting for a balance reading after this recharge.")
            projection = recharge_projection(balance, recharges)
            if projection:
                lines.extend(projection)
    else:
        lines.append("Current balance: unavailable; will retry.")
    return "\n".join(lines)


def recharge_projection(balance, recharges):
    """An explicit credit scenario, never a measured or exact current balance."""
    bt = instant(balance.get("readingTime"))
    opening = number(balance.get("balance"))
    now = datetime.now(DHAKA)
    if recharges is None or opening is None or not bt or not now - timedelta(days=34) <= bt <= now:
        return []
    credits = Decimal(0)
    seen = set()
    for row in recharges:
        rd = instant(row.get("rechargeDate"))
        if rd is None:
            return []
        if not bt < rd <= now:
            continue
        if str(row.get("orderStatus", "")).lower() != "successful":
            return []
        energy = number(row.get("energyAmount"))
        key = row.get("orderID")
        if (
            energy is None
            or energy < 0
            or not key
            or not balance.get("meterNo")
            or row.get("meterNo") != balance.get("meterNo")
        ):
            return []
        if key in seen:
            return []
        seen.add(key)
        credits += energy
    if not seen:
        return []
    return [
        f"Balance + new credits: {money(opening)} + {money(credits)} = {money(opening + credits)}",
        "Estimate before later usage/fees; assumes credits reached the meter.",
    ]


def audit_report(bundle, comparison, tariff_result):
    lines = ["🔎 DESCO account checks"]
    receipts = bundle.get("recharges", [])
    audits = [receipt_audit(r) for r in receipts]
    lines += [
        f"Receipts checked: {len(audits)}",
        f"Arithmetic matches: {sum(a['state'] == 'matched' for a in audits)}",
        f"Receipt discrepancies: {sum(a['state'] == 'discrepancy' for a in audits)}",
        f"Incomplete receipts: {sum(a['state'] == 'incomplete' for a in audits)}",
    ]
    for r, a in zip(receipts, audits):
        if a["state"] == "discrepancy":
            lines.append(f"• {r.get('rechargeDate')}: {money(a['difference'])} — {a['reason']}")
    if comparison["state"] == "matched":
        lines.append("Latest comparable balance interval: internal arithmetic matches.")
    elif comparison["state"] == "candidate":
        lines.append(f"⚠️ Unexplained balance/cost difference: {money(comparison['difference'])}.")
        lines.append(
            "This is a candidate discrepancy; source timing and missing adjustments still need checking."
        )
    else:
        lines.append("Balance comparison pending: " + comparison["reason"])
    lines += [
        tariff_result,
        "These checks do not independently verify the physical meter or prove misconduct.",
    ]
    if bundle.get("cached") or bundle.get("unavailable"):
        lines.append("⚠️ Some sources are cached/unavailable; audit is incomplete.")
    return "\n".join(lines)
