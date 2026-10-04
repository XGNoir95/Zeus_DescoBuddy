import asyncio
import hashlib
import json
from datetime import datetime, timedelta
from decimal import Decimal

from .accounting import (
    DHAKA,
    Tariffs,
    balance_audit,
    daily_deltas,
    day,
    instant,
    money,
    number,
    receipt_audit,
)
from .desco import DescoError
from .reports import audit_report, period, receipt
from .schedule import latest_slot
from .storage import utcnow


class Service:
    def __init__(self, store, client, config):
        self.store, self.client, self.config = store, client, config
        self.lock = asyncio.Lock()
        self.tariffs = Tariffs(config.tariff_file)

    async def connect(self, account):
        async with self.lock:
            system, balance, info = await self.client.discover(account)
            # No local mutation until the new account has been validated.
            old = self.store.get("profile")
            if old and old["account"] != account:
                raise ValueError(
                    "Disconnect the existing account first (/disconnect). This prevents mixing financial records."
                )
            if old:
                return
            profile = {
                "account": account,
                "system": system,
                "meter": str((balance or info or {}).get("meterNo") or ""),
                "connected": utcnow(),
                "timezone": self.config.timezone,
                "paused": False,
                "alerts": {"recharge": True, "mismatch": True, "low": "200"},
                "category": "",
            }
            try:
                if info is None:
                    info = await self.client.request(
                        system, "getCustomerInfo", account, meterNo=profile["meter"]
                    )
                if isinstance(info, dict):
                    profile["category"] = str(info.get("tariffSolution") or "")
            except DescoError:
                pass
            self.store.set("profile", profile)
            if balance is not None:
                self.store.set("cache:balance", {"fetched": utcnow(), "data": balance})
                self.store.evidence("balance", balance)
                self.store.set("current_reading", balance)
        await self.refresh()

    async def refresh(self, *, force=False):
        async with self.lock:
            profile = self.store.get("profile")
            if not profile:
                raise ValueError("Connect your account first with /connect ACCOUNT_NUMBER.")
            last = self.store.get("last_refresh")
            if not force and last and (datetime.now(DHAKA) - instant(last)).total_seconds() < 30:
                return self.bundle()
            today = datetime.now(DHAKA).date()
            start = min(today.replace(day=1), today - timedelta(days=7)) - timedelta(days=1)
            account, system, meter = profile["account"], profile["system"], profile["meter"]
            results = await asyncio.gather(
                self.client.balance(account, system, meter),
                self.client.daily(account, system, start, today, meter),
                self.client.recharges(account, system, today - timedelta(days=35), today, meter),
                return_exceptions=True,
            )
            failures = []
            for kind, data in zip(("balance", "daily", "recharges"), results):
                if isinstance(data, Exception):
                    failures.append(kind)
                    continue
                self.store.evidence(kind, data)
                if kind == "balance":
                    current = self.store.get("current_reading")
                    oldtime = instant((current or {}).get("readingTime"))
                    newtime = instant(data.get("readingTime"))
                    if oldtime and newtime and newtime < oldtime:
                        failures.append(kind)
                        continue
                    if oldtime and newtime and newtime > oldtime:
                        self.store.set("previous_reading", current)
                    # Do not roll a current reading backwards due to a backend regression.
                    if not oldtime or (newtime and newtime >= oldtime):
                        self.store.set("current_reading", data)
                self.store.set("cache:" + kind, {"fetched": utcnow(), "data": data})
            self.store.set("failures", failures)
            self.store.set("last_refresh", utcnow())
            bundle = self.bundle()
            if "recharges" not in failures:
                self.process_recharges(bundle)
            self.process_alerts(bundle)
            return bundle

    def bundle(self):
        p = self.store.get("profile", {})
        bundle = {"account": p.get("account", ""), "cached": {}, "unavailable": [], "fetched": {}}
        for kind in ("balance", "daily", "recharges"):
            cached = self.store.get("cache:" + kind)
            bundle[kind] = cached["data"] if cached else ({} if kind == "balance" else [])
            if cached:
                bundle["fetched"][kind] = cached["fetched"]
            if kind in self.store.get("failures", []) or cached is None:
                if cached:
                    bundle["cached"][kind] = cached["fetched"]
                else:
                    bundle["unavailable"].append(kind)
        return bundle

    async def usage_history(self, month):
        async with self.lock:
            p = self.store.get("profile")
            if not p:
                raise ValueError("Connect your account first.")
            today = datetime.now(DHAKA).date()
            if month > today:
                raise ValueError("Choose this month or an earlier month.")
            next_month = (month.replace(day=28) + timedelta(days=4)).replace(day=1)
            end = min(next_month - timedelta(days=1), today)
            results = await asyncio.gather(
                self.client.daily(p["account"], p["system"], month - timedelta(days=1), end, p["meter"]),
                self.client.recharges(p["account"], p["system"], month, end, p["meter"]),
                return_exceptions=True,
            )
            if any(isinstance(r, Exception) for r in results):
                raise DescoError("Could not fetch the full month's records. Please retry /usage_history.")
            daily, recharges = results
            self.store.evidence("daily", daily)
            self.store.evidence("recharges", recharges)
            return {"daily": daily, "recharges": recharges}, end

    def process_recharges(self, bundle):
        p = self.store.get("profile")
        known = self.store.get("seen_recharges")
        baseline = known is None
        known = known or {}
        pending = self.store.get("pending_recharges", {})
        for row in bundle["recharges"]:
            order = str(row.get("orderID") or "")
            if not order:
                continue  # Cannot reliably identify a transaction. Still visible in reports.
            key = hashlib.sha256(order.encode()).hexdigest()
            fingerprint = hashlib.sha256(json.dumps(row, sort_keys=True).encode()).hexdigest()
            if not baseline and key not in known:
                if p["alerts"]["recharge"] and not p["paused"]:
                    bal = (
                        None
                        if "balance" in bundle["cached"] or "balance" in bundle["unavailable"]
                        else bundle["balance"]
                    )
                    self.store.enqueue(
                        "recharge:" + key, receipt(row, bal, new=True, recharges=bundle["recharges"])
                    )
                    bt = instant((bal or {}).get("readingTime"))
                    rd = instant(row.get("rechargeDate"))
                    if not bt or not rd or bt < rd:
                        pending[key] = row
            elif not baseline and key in known and known[key] != fingerprint:
                if p["alerts"]["recharge"] and not p["paused"]:
                    self.store.enqueue(
                        "recharge-update:" + key + ":" + fingerprint,
                        "🔄 Recharge record updated\n"
                        + receipt(row, bundle["balance"], recharges=bundle["recharges"]),
                    )
            known[key] = fingerprint
        if p["paused"] or not p["alerts"]["recharge"]:
            pending = {}
        elif "balance" not in bundle["cached"] and "balance" not in bundle["unavailable"]:
            b = bundle["balance"]
            bt = instant(b.get("readingTime"))
            for key, row in list(pending.items()):
                rd = instant(row.get("rechargeDate"))
                if bt and rd and bt >= rd:
                    self.store.enqueue(
                        "recharge-balance:" + key,
                        f"⚡ Balance reading after recharge\nRecharge paid: {money(row.get('totalAmount'))}\n"
                        f"Latest reported balance: {money(b.get('balance'))}\n"
                        f"DESCO reading: {b.get('readingTime')}\n"
                        "This is a later reading, not proof of the exact credit applied; consumption may have occurred.",
                    )
                    del pending[key]
        self.store.set("seen_recharges", known)
        self.store.set("pending_recharges", pending)

    def comparison(self, bundle):
        history_ok = not any(
            k in bundle["cached"] or k in bundle["unavailable"] for k in ("balance", "recharges")
        )
        return balance_audit(
            self.store.get("previous_reading"),
            self.store.get("current_reading"),
            bundle["recharges"],
            history_ok,
        )

    def process_alerts(self, bundle):
        p = self.store.get("profile")
        if p["paused"]:
            return
        b = bundle["balance"]
        balance, threshold = number(b.get("balance")), number(p["alerts"].get("low"))
        ts = instant(b.get("readingTime"))
        if (
            "balance" not in bundle["cached"]
            and ts
            and datetime.now(DHAKA) - ts < timedelta(hours=self.config.stale_hours)
        ):
            if balance is not None and threshold is not None and balance < threshold:
                last = instant(self.store.get("last_low_alert"))
                if not last or datetime.now(DHAKA) - last >= timedelta(hours=24):
                    self.store.enqueue(
                        "low:" + datetime.now(DHAKA).date().isoformat(),
                        f"⚠️ Low balance: {money(balance)}\nYour threshold: {money(threshold)}\nDESCO reading: {b.get('readingTime')}",
                    )
                    self.store.set("last_low_alert", utcnow())
        if not p["alerts"]["mismatch"]:
            return
        if "recharges" not in bundle["cached"] and "recharges" not in bundle["unavailable"]:
            for r in bundle["recharges"]:
                a = receipt_audit(r)
                if a["state"] == "discrepancy":
                    digest = hashlib.sha256(json.dumps([r, a], sort_keys=True).encode()).hexdigest()
                    self.store.enqueue(
                        "receipt-audit:" + digest, "⚠️ Receipt arithmetic needs review\n" + receipt(r)
                    )
        check = self.comparison(bundle)
        if check["state"] == "candidate":
            digest = hashlib.sha256(json.dumps(check, sort_keys=True).encode()).hexdigest()
            self.store.enqueue(
                "balance-audit:" + digest,
                f"⚠️ Possible balance/cost mismatch\nUnexplained difference: {money(check['difference'])}\n"
                f"Interval: {check['from']} → {check['to']}\n"
                "DESCO timing or missing adjustments may explain it. This is not a confirmed overcharge. Use /audit and /export.",
            )

    def tariff_check(self, bundle):
        profile = self.store.get("profile")
        rows = daily_deltas(bundle.get("daily", []))
        today = datetime.now(DHAKA).date()
        end = today - timedelta(days=1)
        start = end.replace(day=1)
        selected = [r for r in rows if start <= day(r["date"]) <= end]
        if len(selected) != end.day or any(r["units"] is None or r["cost"] is None for r in selected):
            return "Independent tariff check: pending complete month-to-date consumption records."
        # A tariff change during the month requires explicit allocation; do not guess.
        category = profile.get("category", "")
        if self.tariffs.rule(category, start) != self.tariffs.rule(category, end):
            return "Independent tariff check: tariff changed within month; manual allocation needed."
        total = self.tariffs.total(category, end, sum(number(r["units"]) for r in selected))
        if total is None:
            return "Independent tariff check: unavailable until an applicable official tariff is verified and configured."
        actual = sum((number(r["cost"]) for r in selected), Decimal(0))
        return (
            f"Independent energy-only tariff estimate through {end}: {money(total)}; "
            f"DESCO dated-record cost: {money(actual)}; difference: {money(actual - total)}. "
            "Estimate excludes VAT/fixed charges; a difference requires review of timing and adjustments."
        )

    def audit(self, bundle):
        return audit_report(bundle, self.comparison(bundle), self.tariff_check(bundle))

    def schedule_report(self, bundle):
        schedule = self.store.get("schedule")
        p = self.store.get("profile")
        if not schedule or not p or p["paused"]:
            return
        slot = latest_slot(schedule, datetime.now(DHAKA))
        enabled = instant(self.store.get("schedule_enabled"))
        if enabled and slot < enabled:
            return
        # Scheduled calendar ranges are DESCO/Dhaka dates; custom notification zone only affects delivery.
        end = slot.astimezone(DHAKA).date() - timedelta(days=1)
        start = end - timedelta(days=6 if schedule["mode"] == "weekly" else 0)
        event = "report:" + self.store.get("schedule_enabled", "") + ":" + slot.isoformat()
        selected = {r["date"]: r for r in daily_deltas(bundle.get("daily", []))}
        complete = (
            all(
                selected.get((start + timedelta(days=i)).isoformat(), {}).get("units") is not None
                and selected.get((start + timedelta(days=i)).isoformat(), {}).get("cost") is not None
                for i in range((end - start).days + 1)
            )
            and "daily" not in bundle["cached"]
            and "daily" not in bundle["unavailable"]
        )
        state = self.store.get("last_scheduled_report", {})
        if state.get("event") == event:
            if state.get("complete") or not complete:
                return
            outgoing = event + ":completed"
            prefix = "🔄 Previously incomplete report — readings now available\n"
        else:
            outgoing = event
            prefix = ""
        balance_note = ""
        if "balance" in bundle["cached"] or "balance" in bundle["unavailable"]:
            balance_note = "⚠️ Balance refresh failed; any balance below is a saved reading.\n"
        self.store.enqueue(
            outgoing,
            prefix
            + period(bundle, start, end)
            + "\n\n"
            + balance_note
            + f"Latest reported balance: {money(bundle['balance'].get('balance'))}\n"
            f"Balance reading time: {bundle['balance'].get('readingTime') or 'Unavailable'}\n"
            "Use /audit for accounting checks.",
        )
        self.store.set("last_scheduled_report", {"event": event, "complete": complete})

    async def tick(self, bot):
        p = self.store.get("profile")
        self.store.set("heartbeat", utcnow())
        if not p:
            return
        last = instant(self.store.get("last_refresh"))
        if last is None or datetime.now(DHAKA) - last >= timedelta(seconds=self.config.poll_seconds):
            bundle = await self.refresh()
        else:
            bundle = self.bundle()
        self.schedule_report(bundle)
        if not p["paused"]:
            for event, message in self.store.pending():
                current = self.store.get("profile")
                if not current or current["paused"] or current["connected"] != p["connected"]:
                    break
                if not self.store.is_pending(event):
                    continue
                sent = await bot.send_message(chat_id=self.config.owner, text=message[:4000])
                self.store.track_message(sent)
                self.store.delivered(event)
