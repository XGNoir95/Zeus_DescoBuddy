from datetime import date, datetime, timedelta
from unittest.mock import AsyncMock

import pytest

from descobuddy.accounting import DHAKA
from descobuddy.config import Config
from descobuddy.desco import DescoError
from descobuddy.service import Service
from descobuddy.storage import Store


@pytest.fixture
def service(tmp_path):
    config = Config("123456:" + "a" * 35, 42, tmp_path)
    store = Store(tmp_path)
    api = AsyncMock()
    bal = {
        "balance": "1000",
        "meterNo": "M",
        "accountNo": "123456",
        "currentMonthConsumption": "50",
        "readingTime": datetime.now(DHAKA).isoformat(),
    }
    api.discover.return_value = ("unified", bal, None)
    api.balance.return_value = bal
    api.daily.return_value = []
    api.recharges.return_value = []
    api.request.return_value = {"tariffSolution": "LT-A"}
    s = Service(store, api, config)
    yield s
    s.store.close()


def expire(s):
    s.store.set("last_refresh", (datetime.now(DHAKA) - timedelta(minutes=10)).isoformat())


async def test_history_fetches_selected_month_with_previous_day_without_replacing_live_cache(service):
    await service.connect("123456")
    cached = service.store.get("cache:daily")
    bundle, end = await service.usage_history(date(2026, 9, 1))
    assert end == date(2026, 9, 30)
    service.client.daily.assert_awaited_with("123456", "unified", date(2026, 8, 31), end, "M")
    assert service.store.get("cache:daily") == cached
    assert bundle["daily"] == []


async def test_forced_refresh_bypasses_recent_cached_snapshot(service):
    await service.connect("123456")
    service.client.daily.reset_mock()
    await service.refresh()
    service.client.daily.assert_not_awaited()
    await service.refresh(force=True)
    service.client.daily.assert_awaited_once()


async def test_customer_verified_without_balance_connects_and_recovers(service):
    service.client.discover.return_value = ("tkdes", None, {"meterNo": "M", "tariffSolution": "LT-A"})
    service.client.balance.side_effect = DescoError("Balance unavailable")
    await service.connect("123456")
    assert service.store.get("profile")["meter"] == "M"
    assert service.store.get("profile")["category"] == "LT-A"
    assert service.store.get("cache:balance") is None
    assert "balance" in service.bundle()["unavailable"]
    service.client.balance.side_effect = None
    expire(service)
    await service.refresh()
    assert "balance" not in service.bundle()["unavailable"]


def recharge(order="one", **kw):
    return {
        "orderID": order,
        "rechargeDate": datetime.now(DHAKA).isoformat(),
        "totalAmount": "1000",
        "energyAmount": "1000",
        "VAT": "0",
        "rebate": "0",
        "chargeItems": [],
        "orderStatus": "Pending",
    } | kw


async def test_new_recharge_survives_restart_no_historical_spam(service):
    service.client.recharges.return_value = [recharge("old")]
    await service.connect("123456")
    assert service.store.pending() == []
    fresh = recharge("new")
    service.client.recharges.return_value.append(fresh)
    expire(service)
    await service.refresh()
    assert len(service.store.pending()) == 1
    event, message = service.store.pending()[0]
    assert "New recharge" in message and "1000" not in message  # formatted with comma
    service.store.delivered(event)
    service.store.close()
    service.store = Store(service.config.data_dir)
    expire(service)
    await service.refresh()
    assert service.store.pending() == []


async def test_failed_history_does_not_seed_empty_baseline(service):
    service.client.recharges.side_effect = DescoError("unavailable")
    await service.connect("123456")
    assert service.store.get("seen_recharges") is None
    service.client.recharges.side_effect = None
    service.client.recharges.return_value = [recharge("existing")]
    expire(service)
    await service.refresh()
    assert service.store.pending() == []


async def test_partial_outage_preserves_and_labels_cached_balance(service):
    await service.connect("123456")
    service.client.balance.side_effect = DescoError("unavailable")
    expire(service)
    bundle = await service.refresh()
    assert bundle["balance"]["balance"] == "1000"
    assert "balance" in bundle["cached"]
    assert service.comparison(bundle)["state"] == "pending"


async def test_pending_balance_followup_and_no_duplicate(service):
    service.client.balance.return_value = service.client.balance.return_value | {
        "readingTime": (datetime.now(DHAKA) - timedelta(hours=1)).isoformat()
    }
    await service.connect("123456")
    row = recharge()
    service.client.recharges.return_value = [row]
    expire(service)
    await service.refresh()
    assert len(service.store.pending()) == 1
    service.client.balance.return_value = service.client.balance.return_value | {
        "readingTime": (datetime.now(DHAKA) + timedelta(seconds=1)).isoformat(),
        "balance": "1950",
    }
    expire(service)
    await service.refresh()
    assert len(service.store.pending()) == 2
    expire(service)
    await service.refresh()
    assert len(service.store.pending()) == 2


async def test_pause_keeps_collecting_without_notifications(service):
    await service.connect("123456")
    p = service.store.get("profile")
    p["paused"] = True
    service.store.set("profile", p)
    service.client.recharges.return_value = [recharge()]
    expire(service)
    await service.refresh()
    assert service.store.pending() == []
    assert service.store.get("seen_recharges")


async def test_send_failure_leaves_durable_message_for_retry(service):
    await service.connect("123456")
    service.store.enqueue("test", "hello")
    bot = AsyncMock()
    bot.send_message.side_effect = RuntimeError()
    with pytest.raises(RuntimeError):
        await service.tick(bot)
    assert service.store.pending()
    bot.send_message.side_effect = None
    await service.tick(bot)
    assert not service.store.pending()


async def test_encrypted_data_and_delete(service):
    await service.connect("123456")
    service.store.db.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    data = (service.config.data_dir / "descobuddy.sqlite3").read_bytes()
    assert b'"account": "123456"' not in data
    service.store.disconnect()
    assert service.store.get("profile") is None
    assert service.store.records() == [] and service.store.pending() == []


async def test_regressed_source_reading_does_not_replace_latest_balance(service):
    await service.connect("123456")
    current = service.store.get("cache:balance")["data"]
    service.client.balance.return_value = current | {
        "readingTime": (datetime.now(DHAKA) - timedelta(days=3)).isoformat(),
        "balance": "3000",
    }
    expire(service)
    bundle = await service.refresh()
    assert bundle["balance"]["balance"] == "1000"
    assert "balance" in bundle["cached"]


async def test_incomplete_scheduled_report_followup_survives_restart(service):
    from descobuddy.schedule import latest_slot, parse_schedule

    await service.connect("123456")
    s = parse_schedule(["daily", "08:00"], "Asia/Dhaka")
    service.store.set("schedule", s)
    service.store.set("schedule_enabled", (datetime.now(DHAKA) - timedelta(days=2)).isoformat())
    bundle = service.bundle()
    service.schedule_report(bundle)
    assert len(service.store.pending()) == 1
    service.schedule_report(bundle)
    assert len(service.store.pending()) == 1
    end = latest_slot(s, datetime.now(DHAKA)).date() - timedelta(days=1)
    previous = end - timedelta(days=1)
    bundle["daily"] = [
        {"date": previous.isoformat(), "consumedUnit": 100, "consumedTaka": 100},
        {"date": end.isoformat(), "consumedUnit": 105, "consumedTaka": 150},
    ]
    service.schedule_report(bundle)
    assert len(service.store.pending()) == 2
    service.store.close()
    service.store = Store(service.config.data_dir)
    service.schedule_report(bundle)
    assert len(service.store.pending()) == 2
