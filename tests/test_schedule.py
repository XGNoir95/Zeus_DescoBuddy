from datetime import datetime
from zoneinfo import ZoneInfo

import pytest

from descobuddy.schedule import latest_slot, next_slot, parse_schedule


def test_daily_dhaka_and_restart_catchup():
    schedule = parse_schedule(["daily", "08:00"], "Asia/Dhaka")
    now = datetime(2026, 10, 3, 7, 59, tzinfo=ZoneInfo("Asia/Dhaka"))
    assert latest_slot(schedule, now).day == 2
    assert next_slot(schedule, now).day == 3
    assert next_slot(schedule, now).hour == 8
    now = now.replace(hour=9)
    assert latest_slot(schedule, now).day == 3


def test_weekly_friday():
    s = parse_schedule(["weekly", "fri", "20:00"], "Asia/Dhaka")
    now = datetime(2026, 10, 3, 9, 0, tzinfo=ZoneInfo("Asia/Dhaka"))
    assert latest_slot(s, now).weekday() == 4
    assert next_slot(s, now).day == 9


@pytest.mark.parametrize(
    "args", [["daily", "25:00"], ["weekly", "xxx", "08:00"], ["daily"], ["daily", "00:00", "extra"]]
)
def test_bad_schedule_rejected(args):
    with pytest.raises(ValueError):
        parse_schedule(args, "Asia/Dhaka")
