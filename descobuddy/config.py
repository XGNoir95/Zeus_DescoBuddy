import os
import re
from dataclasses import dataclass
from pathlib import Path
from zoneinfo import ZoneInfo

from dotenv import load_dotenv


@dataclass(frozen=True)
class Config:
    token: str
    owner: int
    data_dir: Path
    timezone: str = "Asia/Dhaka"
    poll_seconds: int = 300
    stale_hours: int = 24
    tariff_file: str = ""

    @classmethod
    def load(cls):
        load_dotenv()
        token = os.getenv("TELEGRAM_BOT_TOKEN", "").strip()
        owner = os.getenv("OWNER_TELEGRAM_ID", "").strip()
        if not re.fullmatch(r"\d+:[A-Za-z0-9_-]{25,}", token) or not owner.isdigit() or int(owner) <= 0:
            raise ValueError(
                "Run 'python -m descobuddy setup' to configure a bot token and your numeric Telegram user ID."
            )
        zone = os.getenv("TIMEZONE", "Asia/Dhaka")
        ZoneInfo(zone)
        poll = int(os.getenv("POLL_SECONDS", "300"))
        stale = int(os.getenv("STALE_HOURS", "24"))
        if not 60 <= poll <= 3600 or not 1 <= stale <= 168:
            raise ValueError("POLL_SECONDS must be 60–3600; STALE_HOURS must be 1–168.")
        return cls(
            token,
            int(owner),
            Path(os.getenv("DATA_DIR", "./data")),
            zone,
            poll,
            stale,
            os.getenv("TARIFF_FILE", ""),
        )
