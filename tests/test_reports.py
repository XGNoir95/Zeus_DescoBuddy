from datetime import date, datetime, timedelta

from descobuddy.accounting import DHAKA
from descobuddy.reports import period, receipt, recharge_projection, status, usage_history


def test_partial_records_not_labelled_complete_or_zero():
    today = datetime.now(DHAKA).date()
    bundle = {"daily": [], "cached": {}, "unavailable": ["daily"]}
    text = period(bundle, today, today)
    assert "Waiting for DESCO" in text and "0/1" in text and "Total pending" in text
    assert "৳0.00" not in text
    assert "Today's total may change" in text


def test_status_distinguishes_fetch_and_reading_time():
    old = datetime.now(DHAKA) - timedelta(days=2)
    bundle = {
        "balance": {"balance": "-5.50", "readingTime": old.isoformat()},
        "daily": [],
        "cached": {"balance": old.isoformat()},
        "unavailable": [],
    }
    text = status(bundle)
    assert "over a day old" in text and "refresh failed" in text and "-5.50" in text
    assert "Today's reading is pending" in text


def test_missing_receipt_fields_are_not_a_claim_of_match():
    text = receipt({"totalAmount": 1000})
    assert "pending" in text and "matches" not in text


def test_credit_projection_includes_all_credits_and_labels_unknown_consumption():
    now = datetime.now(DHAKA)
    balance = {"balance": "260.64", "readingTime": (now - timedelta(hours=5)).isoformat(), "meterNo": "M"}
    rows = [
        {
            "orderID": "1",
            "meterNo": "M",
            "orderStatus": "Successful",
            "energyAmount": "4493.39",
            "rechargeDate": (now - timedelta(hours=1)).isoformat(),
        }
    ]
    text = "\n".join(recharge_projection(balance, rows))
    assert "4,754.03" in text and "before later usage/fees" in text
    assert recharge_projection(balance, None) == []
    assert recharge_projection(balance, rows + rows) == []
    rows[0]["orderStatus"] = "Pending"
    assert recharge_projection(balance, rows) == []


def test_pending_today_always_shows_latest_cost_and_average_calculation():
    today = datetime.now(DHAKA).date()
    rows = [
        {"date": (today - timedelta(days=2)).isoformat(), "consumedUnit": "100", "consumedTaka": "10"},
        {"date": (today - timedelta(days=1)).isoformat(), "consumedUnit": "110", "consumedTaka": "70"},
    ]
    # Stay away from monthly counter reset for a stable synthetic example.
    expected_cost = "70.00" if (today - timedelta(days=1)).day == 1 else "60.00"
    bundle = {"daily": rows}
    for text in (
        status(bundle),
        period(bundle, today, today),
        period(bundle, today - timedelta(days=1), today),
    ):
        assert "Latest day" in text
        assert "10 kWh ×" in text and expected_cost in text
        assert "average" in text


def test_usage_history_groups_same_day_recharges_without_duplicating_daily_cost():
    receipt_row = {
        "totalAmount": "500",
        "energyAmount": "450",
        "VAT": "25",
        "rebate": "-5",
        "chargeItems": [{"name": "Rent", "value": "30"}],
        "orderStatus": "Successful",
    }
    bundle = {
        "recharges": [
            dict(receipt_row, rechargeDate="2026-09-02 09:00:00"),
            dict(receipt_row, rechargeDate="2026-09-02 17:00:00"),
            dict(receipt_row, rechargeDate="2026-09-04 09:00:00"),
        ],
        "daily": [
            {"date": f"2026-09-0{i}", "consumedUnit": str(100 + i * 10), "consumedTaka": str(i * 60)}
            for i in range(1, 5)
        ],
    }
    text = usage_history(bundle, date(2026, 9, 1), date(2026, 9, 5))
    assert text.count("Deduction: ৳50.00") == 3
    assert text.count("02 Sep: 10 kWh") == 1
    assert text.count("04 Sep: 10 kWh") == 1
    assert "05 Sep: Waiting" in text
    assert "including before payment" in text
    assert text.index("2026-09-02 17:00") < text.index("02 Sep: 10") < text.index("2026-09-04 09:00")
