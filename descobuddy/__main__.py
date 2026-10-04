import argparse
import asyncio
import logging
import os
import re
import subprocess
from datetime import datetime, timedelta
from getpass import getpass
from pathlib import Path

from filelock import FileLock, Timeout
from telegram import Bot
from telegram.error import Conflict, InvalidToken, NetworkError

from .accounting import DHAKA, instant
from .bot import build_application
from .config import Config
from .desco import DescoClient
from .network import network_check, telegram_request
from .service import Service
from .storage import Store


def quiet_logging():
    logging.basicConfig(level=logging.WARNING, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    # Telegram tokens and account numbers occur in request URLs. Never log requests.
    for name in ("httpx", "httpcore", "telegram", "apscheduler"):
        logging.getLogger(name).setLevel(logging.CRITICAL)


def setup(*, clipboard=False):
    """User-operated local setup; token input is hidden and is never printed."""
    from dotenv import set_key

    print("Create your bot with @BotFather /newbot. Enter its token locally below.")
    if clipboard:
        if os.name != "nt":
            raise ValueError("Clipboard setup is supported on Windows only. Use regular setup instead.")
        print("Copy ONLY the token from BotFather. Clipboard contents will not be displayed.")
        input("Press Enter when the token is copied: ")
        result = subprocess.run(
            ["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", "Get-Clipboard -Raw"],
            capture_output=True,
            text=True,
            check=False,
        )
        if result.returncode:
            raise ValueError("Could not read the clipboard. Use regular setup and Shift+Insert to paste.")
        token = result.stdout.strip()
    else:
        token = getpass("Telegram bot token (hidden): ").strip()
    if not re.fullmatch(r"\d+:[A-Za-z0-9_-]{25,}", token):
        raise ValueError(
            "No complete bot token was received. Copy only the token (numbers:letters), without quotes or the whole BotFather message. Try setup --clipboard on Windows."
        )

    async def identify():
        for attempt in range(3):
            try:
                async with Bot(
                    token, request=telegram_request(), get_updates_request=telegram_request()
                ) as bot:
                    print(f"Validated bot @{bot.username}. Open it in Telegram and send /start.")
                    print("Stop any other copy of this bot before continuing.")
                    input("After sending /start to YOUR bot, press Enter here: ")
                    print("Recent users are shown for choosing your ID; verify which ID is yours.")
                    updates = await bot.get_updates(timeout=10)
                    found = {}
                    for update in updates:
                        if (
                            update.effective_chat
                            and update.effective_chat.type == "private"
                            and update.effective_user
                        ):
                            u = update.effective_user
                            found[u.id] = u.username or u.first_name
                    for ident, name in found.items():
                        print(f"User ID: {ident}; Telegram name: {name}")
                    if not found:
                        print(
                            "No recent /start found. Supply your known Telegram user ID, or cancel and retry."
                        )
                    return
            except InvalidToken:
                raise ValueError(
                    "Telegram rejected this token. Copy the complete current token from BotFather. If revoked, obtain a new one with /token."
                ) from None
            except Conflict:
                raise ValueError(
                    "Another bot process or webhook is using this token. Stop the other copy before setup."
                ) from None
            except NetworkError:
                if attempt == 2:
                    raise ValueError(
                        "Could not reach Telegram after 3 attempts. Check internet/VPN/proxy, then retry setup. This error does not establish that the token is wrong."
                    ) from None
                print(f"Telegram connection failed; retrying ({attempt + 1}/3)…")
                await asyncio.sleep(2)

    asyncio.run(identify())
    owner = input("Your numeric Telegram user ID (verify it is yours): ").strip()
    if not owner.isdigit() or int(owner) <= 0:
        raise ValueError("A positive numeric Telegram user ID is required.")
    path = Path(".env")
    if path.exists() and input("Update existing .env token and owner? [y/N]: ").lower() != "y":
        return
    if not path.exists():
        path.touch(mode=0o600)
    set_key(str(path), "TELEGRAM_BOT_TOKEN", token)
    set_key(str(path), "OWNER_TELEGRAM_ID", owner)
    print("Saved locally to .env. Run: python -m descobuddy run")


async def doctor(config):
    async with Bot(config.token, request=telegram_request(), get_updates_request=telegram_request()) as bot:
        me = await bot.get_me()
        webhook = await bot.get_webhook_info()
        print(f"Telegram authentication OK: @{me.username}")
        print("Webhook configured: " + ("YES — remove it before polling this bot" if webhook.url else "no"))
        print(f"Restricted to Telegram user ID {config.owner} in private chat.")
    store = Store(config.data_dir)
    client = DescoClient()
    try:
        if store.get("profile"):
            service = Service(store, client, config)
            bundle = await service.refresh()
            print(
                "DESCO available sources:",
                ", ".join(
                    k
                    for k in ("balance", "daily", "recharges")
                    if k not in bundle["cached"] and k not in bundle["unavailable"]
                ),
            )
            print("Some sources missing/cached:", bool(bundle["cached"] or bundle["unavailable"]))
        else:
            print("No account connected yet. Start the bot and use /connect in Telegram.")
    finally:
        await client.close()
        store.close()


def main():
    quiet_logging()
    parser = argparse.ArgumentParser(description="DescoBuddy private Telegram bot")
    parser.add_argument(
        "command", choices=["run", "setup", "doctor", "health", "network-check"], nargs="?", default="run"
    )
    parser.add_argument(
        "--clipboard",
        action="store_true",
        help="Windows setup: read token locally from clipboard without displaying it",
    )
    args = parser.parse_args()
    try:
        if args.command == "network-check":
            asyncio.run(network_check())
            return
        if args.command == "setup":
            setup(clipboard=args.clipboard)
            return
        config = Config.load()
        config.data_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
        if args.command == "health":
            if not (config.data_dir / "descobuddy.sqlite3").exists():
                raise ValueError("Bot database does not exist yet.")
            store = Store(config.data_dir)
            heartbeat = instant(store.get("heartbeat"))
            store.close()
            if not heartbeat or datetime.now(DHAKA) - heartbeat > timedelta(minutes=10):
                raise ValueError("Bot scheduler heartbeat missing or older than 10 minutes.")
            print("Scheduler heartbeat OK (does not guarantee DESCO freshness).")
            return
        with FileLock(str(config.data_dir / "bot.lock"), timeout=0):
            if args.command == "doctor":
                asyncio.run(doctor(config))
                return
            store = Store(config.data_dir)
            client = DescoClient()
            service = Service(store, client, config)
            app = build_application(config, service)
            print("DescoBuddy starting. Access restricted to configured owner; Ctrl+C to stop.")
            try:
                app.run_polling(
                    drop_pending_updates=False,
                    bootstrap_retries=3,
                    allowed_updates=["message", "callback_query"],
                )
            finally:
                store.close()
    except Timeout:
        parser.exit(
            1, "Another process is using this data directory. Stop it before running doctor or another bot.\n"
        )
    except (ValueError, KeyError) as exc:
        parser.exit(1, str(exc) + "\n")
    except Exception as exc:
        # No traceback with credential-bearing request URLs.
        parser.exit(
            1,
            f"Startup failed ({type(exc).__name__}). Check your configuration, network and token; no secrets were logged.\n",
        )


if __name__ == "__main__":
    main()
