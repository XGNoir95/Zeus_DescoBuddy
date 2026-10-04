"""Decimal-only calculations. Missing inputs never become zero or proof of wrongdoing."""

import json
from datetime import date, datetime, timedelta
from decimal import Decimal, InvalidOperation
from zoneinfo import ZoneInfo

DHAKA = ZoneInfo("Asia/Dhaka")
CENT = Decimal("0.01")


def number(value):
    if value is None or isinstance(value, bool):
        return None
    try:
        result = Decimal(str(value).replace(",", "").strip())
        return result if result.is_finite() else None
    except InvalidOperation:
        return None


def money(value):
    n = number(value)
    return "Unavailable" if n is None else f"৳{n:,.2f}"


def instant(value):
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return dt.replace(tzinfo=DHAKA) if dt.tzinfo is None else dt.astimezone(DHAKA)
    except (ValueError, TypeError):
        return None


def day(value):
    try:
        return date.fromisoformat(str(value)[:10])
    except ValueError:
        return None


def daily_deltas(rows):
    """Follow portal's cumulative-unit/monthly-taka semantics without filling gaps.

    Dates remain DESCO record labels; no claim that they are midnight readings.
    Conflicting duplicates, missing predecessors and meter changes invalidate deltas.
    """
    by_date = {}
    conflicts = set()
    for row in rows:
        d = day(row.get("date"))
        if d is None:
            continue
        if d in by_date and by_date[d] != row:
            conflicts.add(d)
        by_date[d] = row
    result = []
    for d, row in sorted(by_date.items()):
        previous = by_date.get(d - timedelta(days=1))
        record = {"date": d.isoformat(), "units": None, "cost": None, "note": ""}
        if d in conflicts or d - timedelta(days=1) in conflicts:
            record["note"] = "Conflicting duplicate source records"
        elif not previous:
            record["note"] = "Previous date missing; daily difference unavailable"
        elif previous.get("meterNo") and row.get("meterNo") != previous.get("meterNo"):
            record["note"] = "Meter changed; daily difference unavailable"
        else:
            u, pu = number(row.get("consumedUnit")), number(previous.get("consumedUnit"))
            t, pt = number(row.get("consumedTaka")), number(previous.get("consumedTaka"))
            if u is not None and pu is not None and u >= pu:
                record["units"] = str(u - pu)
            if t is not None and t >= 0 and (d.day == 1 or (pt is not None and t >= pt)):
                record["cost"] = str(t if d.day == 1 else t - pt)
            if record["units"] is None or record["cost"] is None:
                record["note"] = "Missing value, counter reset or correction; cannot fully reconcile"
        result.append(record)
    return result


def receipt_audit(row):
    """DESCO uses signed rebate (usually negative), and item.value for charges.

    Use the aggregate chargeAmount when available, never add it AND its detail.
    Without complete charge evidence, do not assume no charges.
    """
    gross = number(row.get("totalAmount"))
    energy = number(row.get("energyAmount"))
    vat = number(row.get("VAT"))
    rebate = number(row.get("rebate"))
    items = row.get("chargeItems")
    charges = number(row.get("chargeAmount"))
    detail_total = None
    if isinstance(items, list):
        values = [number(i.get("value")) for i in items if isinstance(i, dict)]
        # These fields are separate in the portal; an unfamiliar duplicate VAT/rebate must not be double-counted.
        duplicate_tax = any(
            str(i.get("name", "")).strip().lower() in {"vat", "rebate"} for i in items if isinstance(i, dict)
        )
        if len(values) == len(items) and all(v is not None for v in values) and not duplicate_tax:
            detail_total = sum(values, Decimal(0))
    if charges is None:
        charges = detail_total
    if any(v is None for v in (gross, energy, vat, rebate, charges)):
        return {
            "state": "incomplete",
            "difference": None,
            "reason": "Receipt fields incomplete or charge schema unrecognized",
        }
    if charges < 0 or energy < 0 or gross < 0:
        return {
            "state": "incomplete",
            "difference": None,
            "reason": "Refund/correction requires manual review",
        }
    if detail_total is not None and abs(detail_total - charges) > CENT:
        return {
            "state": "discrepancy",
            "difference": str(charges - detail_total),
            "reason": "Charge total disagrees with itemized charges",
        }
    difference = gross - (energy + vat + rebate + charges)
    return {
        "state": "matched" if abs(difference) <= CENT else "discrepancy",
        "difference": str(difference),
        "reason": "Gross minus energy, VAT, signed rebate and charges",
    }


def balance_audit(previous, current, recharges, history_ok):
    """Only compare same-month snapshots with advancing source times.

    Recharge application times are not guaranteed by receipt timestamps. Never
    assert a balance mismatch across a recharge or a missing history fetch.
    Even a nonzero candidate can be an undocumented adjustment/source timing issue.
    """

    def pending(reason):
        return {"state": "pending", "reason": reason, "difference": None}

    if not previous or not current or not history_ok:
        return pending("Need two readings and an available recharge history")
    p, c = instant(previous.get("readingTime")), instant(current.get("readingTime"))
    if not p or not c or c <= p:
        return pending("Waiting for an advancing DESCO reading timestamp")
    if (p.year, p.month) != (c.year, c.month):
        return pending("Monthly cost counter reset; comparison crosses month boundary")
    if p.date() < datetime.now(DHAKA).date() - timedelta(days=35):
        return pending("Earlier reading predates available recharge coverage")
    if previous.get("meterNo") != current.get("meterNo"):
        return pending("Meter identifier changed")
    for r in recharges:
        rd = instant(r.get("rechargeDate"))
        if rd is None or p - timedelta(days=2) <= rd <= c + timedelta(days=2):
            return pending("Recharge near this interval; exact meter credit application time is unknown")
    vals = [
        number(previous.get("balance")),
        number(current.get("balance")),
        number(previous.get("currentMonthConsumption")),
        number(current.get("currentMonthConsumption")),
    ]
    if any(v is None for v in vals):
        return pending("Balance/monthly cost inputs incomplete")
    opening, closing, before, after = vals
    if after < before:
        return pending("Consumption counter decreased or was corrected")
    difference = opening - closing - (after - before)
    return {
        "state": "matched" if abs(difference) <= CENT else "candidate",
        "difference": str(difference),
        "reason": "Balance drop minus reported month-to-date cost increase",
        "from": p.isoformat(),
        "to": c.isoformat(),
    }


class Tariffs:
    """Optional operator-verified tariff rules; no guessed live rates."""

    def __init__(self, path=""):
        self.rules = []
        if path:
            from pathlib import Path

            self.rules = json.loads(Path(path).read_text(encoding="utf-8"))
            for rule in self.rules:
                if not rule.get("source") or rule.get("verified") is not True:
                    raise ValueError("Every tariff must have a source and verified=true")
                start, end = day(rule.get("from")), day(rule.get("to"))
                if not start or not end or start > end or not rule.get("category"):
                    raise ValueError("Tariff requires category and valid from/to dates")
                last = Decimal(0)
                for i, tier in enumerate(rule["tiers"]):
                    cap, rate = number(tier.get("up_to")), number(tier.get("rate"))
                    if rate is None or rate < 0 or (cap is not None and cap <= last):
                        raise ValueError("Invalid tariff tier")
                    if cap is None and i != len(rule["tiers"]) - 1:
                        raise ValueError("Only the last tariff tier may be unbounded")
                    if cap is not None:
                        last = cap
                if not rule["tiers"] or rule["tiers"][-1].get("up_to") is not None:
                    raise ValueError("Tariff needs a final unbounded tier")
                if "lifeline" in rule:
                    life = rule["lifeline"]
                    if number(life.get("up_to")) is None or number(life.get("rate")) is None:
                        raise ValueError("Invalid lifeline rule")

    def rule(self, category, d):
        matches = [r for r in self.rules if r["category"] == category and day(r["from"]) <= d <= day(r["to"])]
        return matches[0] if len(matches) == 1 else None

    def total(self, category, d, units):
        r, units = self.rule(category, d), number(units)
        if not r or units is None or units < 0:
            return None
        if "lifeline" in r and units <= number(r["lifeline"]["up_to"]):
            return (units * number(r["lifeline"]["rate"])).quantize(CENT)
        amount, lower = Decimal(0), Decimal(0)
        for tier in r["tiers"]:
            upper = number(tier["up_to"])
            used = max(Decimal(0), min(units, upper if upper is not None else units) - lower)
            amount += used * number(tier["rate"])
            if upper is None or units <= upper:
                break
            lower = upper
        return amount.quantize(CENT)
