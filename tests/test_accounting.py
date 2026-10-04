import json
from datetime import datetime, timedelta
from decimal import Decimal

import pytest

from descobuddy.accounting import DHAKA, Tariffs, balance_audit, daily_deltas, number, receipt_audit


def sample_receipt(**overrides):
    row = {
        "orderID": "example-1",
        "rechargeDate": "2026-10-03 12:00:00",
        "totalAmount": "1000.00",
        "energyAmount": "771.41",
        "VAT": "47.62",
        "rebate": "-9.03",
        "orderStatus": "Execution Successful",
        "chargeItems": [{"name": "Demand Charge", "value": "150"}, {"name": "Meter Rent 1P", "value": "40"}],
    }
    return row | overrides


@pytest.mark.parametrize("value", [None, "", "N/A", "NaN", "Infinity", True, [], {}])
def test_unknown_numbers_are_not_zero(value):
    assert number(value) is None


def test_decimal_preserves_negative_balance():
    assert number("-1,002.35") == Decimal("-1002.35")


def test_cumulative_conversion_month_reset_and_gap():
    rows = [
        {"date": "2026-09-29", "consumedUnit": 1000, "consumedTaka": 500},
        {"date": "2026-09-30", "consumedUnit": 1005, "consumedTaka": 550},
        {"date": "2026-10-01", "consumedUnit": 1008, "consumedTaka": 30},
        {"date": "2026-10-03", "consumedUnit": 1018, "consumedTaka": 130},
    ]
    values = daily_deltas(rows)
    assert values[0]["cost"] is None
    assert values[1]["units"] == "5" and values[1]["cost"] == "50"
    assert values[2]["units"] == "3" and values[2]["cost"] == "30"
    assert values[3]["units"] is None and values[3]["cost"] is None


def test_reset_and_duplicate_do_not_manufacture_usage():
    rows = [
        {"date": "2026-10-01", "consumedUnit": 100, "consumedTaka": 10},
        {"date": "2026-10-02", "consumedUnit": 1, "consumedTaka": 2},
    ]
    assert daily_deltas(rows)[1]["cost"] is None
    assert daily_deltas(rows)[1]["units"] is None
    rows.append({"date": "2026-10-02", "consumedUnit": 103, "consumedTaka": 15})
    assert "Conflicting" in daily_deltas(rows)[1]["note"]


def test_receipt_signed_rebate_and_no_double_count():
    assert receipt_audit(sample_receipt())["state"] == "matched"
    assert receipt_audit(sample_receipt(chargeAmount="190"))["state"] == "matched"
    assert receipt_audit(sample_receipt(energyAmount="746.41"))["difference"] == "25.00"
    assert receipt_audit(sample_receipt(chargeAmount="200"))["state"] == "discrepancy"
    assert receipt_audit(sample_receipt(VAT=None))["state"] == "incomplete"


def test_unknown_charge_schema_is_incomplete():
    row = sample_receipt(chargeItems=[{"name": "Demand", "amount": 190}])
    assert receipt_audit(row)["state"] == "incomplete"
    assert receipt_audit(sample_receipt(chargeItems=None))["state"] == "incomplete"


def test_balance_comparison_is_conservative():
    t = datetime.now(DHAKA).replace(day=2, hour=1)
    previous = {
        "balance": "100",
        "currentMonthConsumption": "10",
        "readingTime": t.isoformat(),
        "meterNo": "M",
    }
    current = {
        "balance": "80",
        "currentMonthConsumption": "30",
        "readingTime": (t + timedelta(hours=1)).isoformat(),
        "meterNo": "M",
    }
    assert balance_audit(previous, current, [], True)["state"] == "matched"
    assert balance_audit(previous, current | {"balance": "75"}, [], True)["difference"] == "5"
    assert balance_audit(previous, current, [], False)["state"] == "pending"
    assert balance_audit(current, current, [], True)["state"] == "pending"
    recharge = sample_receipt(rechargeDate=t.isoformat())
    assert balance_audit(previous, current, [recharge], True)["state"] == "pending"
    assert balance_audit(previous, current | {"meterNo": "NEW"}, [], True)["state"] == "pending"


def test_synthetic_tariff_lifeline_repricing_and_expiry(tmp_path):
    # Synthetic rates deliberately not a DESCO tariff; test the algorithm only.
    rule = {
        "category": "TEST",
        "verified": True,
        "source": "synthetic unit test",
        "from": "2026-01-01",
        "to": "2026-12-31",
        "lifeline": {"up_to": 50, "rate": 4},
        "tiers": [{"up_to": 75, "rate": 5}, {"up_to": None, "rate": 8}],
    }
    path = tmp_path / "tariff.json"
    path.write_text(json.dumps([rule]))
    tariffs = Tariffs(str(path))
    from datetime import date

    assert tariffs.total("TEST", date(2026, 10, 1), 50) == Decimal("200")
    assert tariffs.total("TEST", date(2026, 10, 1), 51) == Decimal("255")
    assert tariffs.total("TEST", date(2026, 10, 1), 76) == Decimal("383")
    assert tariffs.total("TEST", date(2027, 1, 1), 50) is None
    assert tariffs.total("UNKNOWN", date(2026, 1, 1), 50) is None
