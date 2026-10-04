import json
from datetime import date

import httpx
import pytest

from descobuddy.desco import DescoClient, DescoError


def test_tkdes_charge_schema_retains_deductions_and_reconciles():
    from descobuddy.accounting import receipt_audit
    from descobuddy.desco import RECHARGE_FIELDS, select

    row = select(
        {
            "totalAmount": 5000,
            "energyAmount": "4493.39",
            "VAT": "238.10",
            "rebate": "-23.49",
            "chargeItems": [
                {"chargeItemName": "Demand Charge-All", "chargeAmount": 252},
                {"chargeItemName": "Meter Rent-1P", "chargeAmount": 40, "token": "PRIVATE"},
            ],
        },
        RECHARGE_FIELDS,
    )
    assert row["chargeItems"] == [
        {"name": "Demand Charge-All", "value": 252},
        {"name": "Meter Rent-1P", "value": 40},
    ]
    assert receipt_audit(row)["state"] == "matched"


def client(handler):
    return DescoClient(httpx.AsyncClient(transport=httpx.MockTransport(handler)))


async def test_fallback_and_financial_field_minimization():
    paths = []

    def handle(request):
        paths.append(request.url.path)
        if "unified" in request.url.path:
            return httpx.Response(200, json={"code": 200, "data": None})
        return httpx.Response(
            200,
            json={"code": 200, "data": {"balance": "-1.25", "accountNo": "123456", "customerName": "SECRET"}},
        )

    api = client(handle)
    kind, balance, info = await api.discover("123456")
    assert kind == "tkdes" and "customerName" not in balance
    assert len(paths) == 2
    await api.close()


@pytest.mark.parametrize("returned_account", ["123456", "654321"])
async def test_discovery_uses_customer_record_only_for_matching_account(returned_account):
    def handle(request):
        data = None
        if "tkdes" in request.url.path and request.url.path.endswith("getCustomerInfo"):
            data = {"accountNo": returned_account, "meterNo": "M", "customerName": "PRIVATE"}
        return httpx.Response(200, json={"code": 200, "data": data})

    api = client(handle)
    if returned_account == "123456":
        kind, balance, info = await api.discover("123456")
        assert kind == "tkdes" and balance is None
        assert info == {"meterNo": "M", "tariffSolution": ""}
    else:
        with pytest.raises(DescoError, match="lookup failed"):
            await api.discover("123456")
    await api.close()


async def test_daily_range_chunking_and_recharge_schema():
    requests = []

    def handle(request):
        requests.append(request)
        return httpx.Response(200, json={"code": 200, "data": []})

    api = client(handle)
    assert await api.daily("123456", "unified", date(2026, 9, 30), date(2026, 10, 31)) == []
    assert len(requests) == 3
    assert requests[0].url.params["dateTo"] == "2026-10-14"
    assert requests[1].url.params["dateFrom"] == "2026-10-15"
    await api.close()


async def test_invalid_response_does_not_create_zero_balance():
    api = client(lambda req: httpx.Response(200, json={"code": 200, "data": {"balance": None}}))
    with pytest.raises(DescoError):
        await api.balance("123456", "unified")
    await api.close()


async def test_account_mismatch_rejected():
    api = client(
        lambda req: httpx.Response(200, json={"code": 200, "data": {"balance": 50, "accountNo": "654321"}})
    )
    with pytest.raises(DescoError, match="different account"):
        await api.balance("123456", "tkdes")
    await api.close()


async def test_http_failure_retry_no_private_url_in_error(monkeypatch):
    calls = 0

    async def no_sleep(_):
        pass

    monkeypatch.setattr("descobuddy.desco.asyncio.sleep", no_sleep)

    def handle(request):
        nonlocal calls
        calls += 1
        return httpx.Response(503, text="unavailable")

    api = client(handle)
    with pytest.raises(DescoError) as exc:
        await api.balance("123456789", "tkdes")
    assert calls == 3 and "123456789" not in str(exc.value)
    await api.close()


async def test_tokens_and_personal_data_not_retained():
    raw = {
        "orderID": "1",
        "totalAmount": 100,
        "token": "SECRET",
        "customerName": "PRIVATE",
        "chargeItems": [{"name": "Meter rent", "value": 40, "privateField": "HIDE"}],
    }
    api = client(lambda req: httpx.Response(200, json={"code": 200, "data": [raw]}))
    rows = await api.recharges("123456", "unified", date(2026, 1, 1), date(2026, 1, 2))
    serialized = json.dumps(rows)
    assert "SECRET" not in serialized and "PRIVATE" not in serialized and "HIDE" not in serialized
    await api.close()
