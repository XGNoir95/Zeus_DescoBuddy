"""Exercise actual PTB command parsing and Telegram serialization with a fake HTTP boundary."""

import json
from datetime import datetime
from unittest.mock import AsyncMock

from telegram import Update
from telegram.ext import ExtBot
from telegram.request import BaseRequest

from descobuddy.accounting import DHAKA
from descobuddy.bot import build_application
from descobuddy.config import Config
from descobuddy.service import Service
from descobuddy.storage import Store


class FakeTelegram(BaseRequest):
    def __init__(self):
        self.calls = []

    @property
    def read_timeout(self):
        return 5

    async def initialize(self):
        pass

    async def shutdown(self):
        pass

    async def do_request(self, url, method, request_data=None, **kwargs):
        name = url.rsplit("/", 1)[-1]
        params = request_data.parameters if request_data else {}
        self.calls.append((name, params))
        if getattr(self, "reject_delete_batch", False) and (
            name == "deleteMessages" or (name == "deleteMessage" and params["message_id"] == 1)
        ):
            return 400, json.dumps(
                {"ok": False, "error_code": 400, "description": "Bad Request: message can't be deleted"}
            ).encode()
        if name == "getMe":
            result = {"id": 999, "is_bot": True, "first_name": "Test", "username": "DescoTestBot"}
        elif name in {"sendMessage", "sendDocument"}:
            result = {
                "message_id": len(self.calls),
                "date": int(datetime.now(DHAKA).timestamp()),
                "chat": {"id": int(params["chat_id"]), "type": "private"},
                "text": params.get("text", ""),
            }
        else:
            result = True
        return 200, json.dumps({"ok": True, "result": result}).encode()


def update(bot, text, user=42, group=False, ident=1):
    return Update.de_json(
        {
            "update_id": ident,
            "message": {
                "message_id": ident,
                "date": int(datetime.now(DHAKA).timestamp()),
                "text": text,
                "entities": [{"type": "bot_command", "offset": 0, "length": len(text.split()[0])}],
                "from": {"id": user, "is_bot": False, "first_name": "User"},
                "chat": {"id": -123 if group else user, "type": "group" if group else "private"},
            },
        },
        bot,
    )


async def test_owner_only_commands_schedule_and_export(tmp_path):
    request = FakeTelegram()
    config = Config("123456:" + "a" * 35, 42, tmp_path)
    bot = ExtBot(config.token, request=request, get_updates_request=FakeTelegram())
    client = AsyncMock()
    now = datetime.now(DHAKA).isoformat()
    balance = {"balance": "123.45", "currentMonthConsumption": "30", "readingTime": now, "meterNo": "M"}
    client.discover.return_value = ("tkdes", balance, None)
    client.balance.return_value = balance
    client.daily.return_value = []
    client.recharges.return_value = []
    client.request.return_value = {"tariffSolution": "Category-A: Residential"}
    store = Store(tmp_path)
    service = Service(store, client, config)
    app = build_application(config, service, bot=bot)
    async with app:
        await app.post_init(app)
        assert any(name == "setMyCommands" for name, _ in request.calls)
        assert len(app.job_queue.jobs()) == 1
        await app.process_update(update(bot, "/start", user=7))
        await app.process_update(update(bot, "/start", group=True))
        assert not [c for c in request.calls if c[0] == "sendMessage"]
        await app.process_update(update(bot, "/start"))
        assert any("DescoBuddy" in c[1].get("text", "") for c in request.calls)
        await app.process_update(update(bot, "/connect 123456"))
        assert store.get("profile")["account"] == "123456"
        await app.process_update(update(bot, "/status"))
        messages = [p["text"] for n, p in request.calls if n == "sendMessage"]
        assert any("123.45" in m and "Today's reading is pending" in m for m in messages)
        store.set(
            "cache:recharges",
            {
                "fetched": now,
                "data": [
                    {"orderID": "a", "rechargeDate": "2026-09-01 12:00:00", "totalAmount": 100},
                    {"orderID": "b", "rechargeDate": "2026-09-02 12:00:00", "totalAmount": 200},
                ],
            },
        )
        request.calls.clear()
        await app.process_update(update(bot, "/recharges"))
        texts = [p["text"] for n, p in request.calls if n == "sendMessage"]
        assert sum("Recharge details" in t for t in texts) == 1
        assert any("2026-09-02" in t for t in texts)
        assert not any("2026-09-01" in t for t in texts)
        request.calls.clear()
        await app.process_update(update(bot, "/history"))
        assert any(
            "2026-09-01" in p.get("text", "") and "2026-09-02" in p.get("text", "") for n, p in request.calls
        )
        await app.process_update(update(bot, "/schedule weekly fri 20:00"))
        assert store.get("schedule")["weekday"] == 4
        await app.process_update(update(bot, "/alerts low off"))
        assert store.get("profile")["alerts"]["low"] is None
        store.enqueue("recharge:queued", "should be cancelled")
        await app.process_update(update(bot, "/alerts recharge off"))
        assert not store.is_pending("recharge:queued")
        await app.process_update(update(bot, "/audit"))
        assert any("Independent tariff check" in p.get("text", "") for n, p in request.calls)
        await app.process_update(update(bot, "/export"))
        assert any(n == "sendDocument" for n, p in request.calls)
        await app.process_update(update(bot, "/pause"))
        assert store.get("profile")["paused"]
        await app.process_update(update(bot, "/resume"))
        assert not store.get("profile")["paused"]
        request.calls.clear()
        await app.process_update(update(bot, "/clear", user=7))
        assert not any(n == "deleteMessages" for n, p in request.calls)
        request.reject_delete_batch = True
        await app.process_update(update(bot, "/clear", ident=20))
        assert any(n == "deleteMessages" and p["chat_id"] == 42 for n, p in request.calls)
        assert any(n == "deleteMessage" and p["message_id"] == 19 for n, p in request.calls)
        assert any(n == "deleteMessage" and p["message_id"] == 1 for n, p in request.calls)
        assert store.get("profile")["account"] == "123456"
        assert store.get("schedule")["weekday"] == 4
        request.calls.clear()
        await app.process_update(update(bot, "/usage_history 2026-09"))
        assert any(
            "Recharge:" in p.get("text", "") and "Days:" in p.get("text", "") for n, p in request.calls
        )
        await app.process_update(update(bot, "/disconnect"))
        # Deletion requires deliberate confirmation.
        assert store.get("profile")
        confirmation = Update.de_json(
            {
                "update_id": 500,
                "callback_query": {
                    "id": "confirm-1",
                    "chat_instance": "private-owner",
                    "data": "confirm_disconnect",
                    "from": {"id": 42, "is_bot": False, "first_name": "User"},
                    "message": {
                        "message_id": 44,
                        "date": 1700000000,
                        "chat": {"id": 42, "type": "private"},
                        "from": {"id": 999, "is_bot": True, "first_name": "Test"},
                        "text": "Confirm?",
                    },
                },
            },
            bot,
        )
        await app.process_update(confirmation)
        assert store.get("profile") is None
        assert store.records() == []
    store.close()
