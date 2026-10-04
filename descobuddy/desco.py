"""Read-only DESCO portal API adapter; no customer enumeration or browser fallback."""

import asyncio
from datetime import date, timedelta

import httpx

from .accounting import number
from .network import connection_reason, tls_context

BASE = "https://prepaid.desco.org.bd/api"
BALANCE_FIELDS = {"accountNo", "meterNo", "balance", "currentMonthConsumption", "readingTime"}
DAILY_FIELDS = {"date", "consumedUnit", "consumedTaka", "meterNo"}
RECHARGE_FIELDS = {
    "orderID",
    "rechargeDate",
    "totalAmount",
    "energyAmount",
    "chargeAmount",
    "VAT",
    "rebate",
    "orderStatus",
    "chargeItems",
    "meterNo",
}


class DescoError(Exception):
    """Safe public message, never includes URL/account or an HTTP exception."""


def select(row, fields):
    # Retain financial evidence, discard names/addresses/phone numbers/tokens.
    result = {k: v for k, v in row.items() if k in fields}
    if "chargeItems" in result and isinstance(result["chargeItems"], list):
        result["chargeItems"] = [
            {
                "name": i.get("name", i.get("chargeItemName")),
                "value": i.get("value", i.get("chargeAmount")),
            }
            for i in result["chargeItems"]
            if isinstance(i, dict)
        ]
    return result


class DescoClient:
    def __init__(self, client=None):
        self.http = client or httpx.AsyncClient(
            verify=tls_context(desco=True),
            timeout=httpx.Timeout(20, connect=10),
            headers={"Accept": "application/json"},
            limits=httpx.Limits(max_connections=4),
        )

    async def close(self):
        await self.http.aclose()

    async def request(self, system, endpoint, account, **params):
        for attempt in range(3):
            try:
                response = await self.http.get(
                    f"{BASE}/{system}/customer/{endpoint}", params={"accountNo": account, **params}
                )
                if response.status_code == 429 or response.status_code >= 500:
                    if attempt < 2:
                        await asyncio.sleep(2**attempt)
                        continue
                response.raise_for_status()
                payload = response.json()
                if not isinstance(payload, dict):
                    raise DescoError("DESCO returned an unrecognized response.")
                if str(payload.get("code")) == "16001":
                    return None
                if str(payload.get("code")) != "200":
                    raise DescoError("DESCO could not complete this request.")
                return payload.get("data")
            except (httpx.HTTPError, ValueError) as exc:
                if attempt == 2:
                    reason = (
                        f"HTTP {exc.response.status_code}"
                        if isinstance(exc, httpx.HTTPStatusError)
                        else connection_reason(exc)
                    )
                    raise DescoError(
                        f"DESCO connection/response failure ({reason}). Please retry later."
                    ) from None
                del exc
                await asyncio.sleep(2**attempt)
        raise DescoError("DESCO temporarily unavailable.")

    async def discover(self, account):
        errors = []
        for system in ("unified", "tkdes"):
            try:
                result = await self.balance(account, system)
                return system, result, None
            except DescoError as exc:
                errors.append((system, str(exc)))
        # The portal's customer record can identify a meter even when its
        # separate balance service is temporarily empty or unavailable.
        for system in ("unified", "tkdes"):
            try:
                info = await self.request(system, "getCustomerInfo", account)
                if not isinstance(info, dict) or str(info.get("accountNo")) != account:
                    continue
                meter = str(info.get("meterNo") or "")
                if not meter:
                    continue
                try:
                    balance = await self.balance(account, system, meter)
                except DescoError:
                    balance = None
                return (
                    system,
                    balance,
                    {
                        "meterNo": meter,
                        "tariffSolution": str(info.get("tariffSolution") or ""),
                    },
                )
            except DescoError:
                continue
        reasons = "; ".join(f"{system}: {reason}" for system, reason in errors)
        raise DescoError(f"DESCO account lookup failed ({reasons}). Please retry later.")

    async def balance(self, account, system, meter=""):
        row = await self.request(system, "getBalance", account, **({"meterNo": meter} if meter else {}))
        if not isinstance(row, dict) or number(row.get("balance")) is None:
            raise DescoError("No valid DESCO balance available for this account.")
        if row.get("accountNo") and str(row["accountNo"]) != account:
            raise DescoError("DESCO returned a different account; response rejected.")
        return select(row, BALANCE_FIELDS)

    async def daily(self, account, system, start: date, end: date, meter=""):
        rows = []
        cursor = start
        while cursor <= end:
            until = min(cursor + timedelta(days=14), end)
            data = await self.request(
                system,
                "getCustomerDailyConsumption",
                account,
                meterNo=meter,
                dateFrom=cursor.isoformat(),
                dateTo=until.isoformat(),
            )
            if not isinstance(data, list) or any(not isinstance(r, dict) for r in data):
                raise DescoError("Daily readings unavailable; no zero values have been assumed.")
            rows.extend(select(r, DAILY_FIELDS) for r in data)
            cursor = until + timedelta(days=1)
        return rows

    async def recharges(self, account, system, start: date, end: date, meter=""):
        data = await self.request(
            system,
            "getRechargeHistory",
            account,
            meterNo=meter,
            dateFrom=start.isoformat(),
            dateTo=end.isoformat(),
        )
        if not isinstance(data, list) or any(not isinstance(r, dict) for r in data):
            raise DescoError("Recharge history unavailable; retrying later.")
        return [select(r, RECHARGE_FIELDS) for r in data]
