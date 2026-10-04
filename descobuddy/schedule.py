from datetime import timedelta
from zoneinfo import ZoneInfo

DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]


def parse_schedule(args, timezone):
    if args == ["off"]:
        return None
    if len(args) not in (2, 3) or args[0] not in {"daily", "weekly"}:
        raise ValueError("Use /schedule daily 08:00 or /schedule weekly fri 20:00 or /schedule off")
    mode = args[0]
    if (mode == "daily" and len(args) != 2) or (mode == "weekly" and len(args) != 3):
        raise ValueError("Use daily HH:MM or weekly fri HH:MM")
    try:
        hour, minute = [int(v) for v in args[-1].split(":")]
        if not 0 <= hour <= 23 or not 0 <= minute <= 59:
            raise ValueError
        weekday = DAYS.index(args[1].lower()) if mode == "weekly" else None
        ZoneInfo(timezone)
    except (ValueError, KeyError):
        raise ValueError("Use a valid 24-hour time and weekday mon/tue/wed/thu/fri/sat/sun.") from None
    return {"mode": mode, "hour": hour, "minute": minute, "weekday": weekday, "timezone": timezone}


def latest_slot(schedule, now):
    """One latest scheduled slot: catches up once after downtime, not every missed day."""
    local = now.astimezone(ZoneInfo(schedule["timezone"]))
    slot = local.replace(hour=schedule["hour"], minute=schedule["minute"], second=0, microsecond=0)
    if schedule["mode"] == "weekly":
        slot -= timedelta(days=(slot.weekday() - schedule["weekday"]) % 7)
        if slot > local:
            slot -= timedelta(days=7)
    elif slot > local:
        slot -= timedelta(days=1)
    return slot


def next_slot(schedule, now):
    return latest_slot(schedule, now) + timedelta(days=7 if schedule["mode"] == "weekly" else 1)
