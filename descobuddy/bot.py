import csv
import json
import logging
import re
from datetime import datetime, timedelta
from io import BytesIO, StringIO
from zipfile import ZIP_DEFLATED, ZipFile
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from telegram import BotCommand, InlineKeyboardButton, InlineKeyboardMarkup, Update
from telegram.error import BadRequest, Conflict, Forbidden, NetworkError, TelegramError
from telegram.ext import (
    Application,
    ApplicationBuilder,
    CallbackQueryHandler,
    CommandHandler,
    ContextTypes,
    MessageHandler,
    filters,
)

from .accounting import DHAKA, daily_deltas
from .desco import DescoError
from .network import telegram_request
from .reports import masked, period, receipt, status, usage_history
from .schedule import next_slot, parse_schedule
from .storage import utcnow

COMMANDS = {
    "start": "Set up your private DESCO bot",
    "connect": "Connect your DESCO account number",
    "status": "Latest available balance and meter reading",
    "today": "Today's published usage and cost",
    "week": "Last seven complete calendar dates",
    "month": "Month-to-date consumption records",
    "recharges": "Latest recharge breakdown and balance",
    "history": "Recharge history in the last 35 days",
    "clear": "Clear recent chat messages (Telegram limits apply)",
    "usage_history": "Monthly recharges, deductions and daily costs",
    "audit": "Check receipt and balance arithmetic",
    "schedule": "Set daily or weekly delivery time",
    "alerts": "Recharge, mismatch and low-balance alerts",
    "settings": "View settings or change timezone",
    "export": "Download CSV and financial evidence ZIP",
    "pause": "Pause automatic messages; continue collecting",
    "resume": "Resume automatic reports and alerts",
    "disconnect": "Delete connected account and local records",
    "cancel": "Cancel account setup",
    "help": "Show commands and examples",
}

HELP = """⚡ DescoBuddy — private DESCO ledger

/connect ACCOUNT_NUMBER — link your account
/status — latest DESCO balance and reading time
/today — today's dated consumption (may be unpublished)
/week — previous 7 dates
/month — month to date
/recharges — latest recharge breakdown and balance
/history — recharge history (last 35 days)
/clear — clear recent chat messages
/usage_history — this month's recharges and daily costs
/usage_history 2026-10 — choose a month
/audit — receipt arithmetic and comparable balance checks
/export — CSV readings + encrypted-at-rest evidence exported privately

/schedule daily 08:00
/schedule weekly fri 20:00
/schedule off
/alerts low 200 (or low off)
/alerts recharge on (or off)
/alerts mismatch on (or off)
/settings timezone Asia/Dhaka
/pause · /resume · /disconnect · /cancel

DESCO can publish readings late. Unavailable does not mean zero. A mismatch is a request for investigation, not proof of overcharging.
"""


def menu():
    return InlineKeyboardMarkup(
        [
            [
                InlineKeyboardButton("⚡ Status", callback_data="status"),
                InlineKeyboardButton("📊 Today", callback_data="today"),
            ],
            [
                InlineKeyboardButton("💳 Latest recharge", callback_data="recharges"),
                InlineKeyboardButton("🔎 Audit", callback_data="audit"),
            ],
            [
                InlineKeyboardButton("🗓 Schedule", callback_data="schedule"),
                InlineKeyboardButton("🔔 Alerts", callback_data="alerts"),
            ],
            [InlineKeyboardButton("📜 Recharge history", callback_data="history")],
            [InlineKeyboardButton("📒 Usage history", callback_data="usage_history")],
        ]
    )


def build_application(config, service, *, bot=None):
    async def startup(app):
        await app.bot.set_my_commands([BotCommand(k, v) for k, v in COMMANDS.items()])
        app.job_queue.run_repeating(
            background, interval=30, first=2, job_kwargs={"max_instances": 1, "coalesce": True}
        )

    async def shutdown(app):
        await service.client.close()

    async def background(context):
        try:
            await service.tick(context.bot)
        except Forbidden:
            p = service.store.get("profile")
            if p:
                p["paused"] = True
                service.store.set("profile", p)
            logging.getLogger(__name__).warning("Telegram delivery forbidden; notifications paused.")
        except Exception as exc:
            # Exception strings can include Telegram token URLs or account numbers.
            logging.getLogger(__name__).warning(
                "Background check failed (%s); will retry.", type(exc).__name__
            )

    async def allowed(update):
        return bool(
            update.effective_user
            and update.effective_user.id == config.owner
            and update.effective_chat
            and update.effective_chat.type == "private"
            and update.effective_chat.id == config.owner
        )

    async def reply(update, text, markup=None):
        if update.effective_message:
            sent = await update.effective_message.reply_text(text[:4000], reply_markup=markup)
            service.store.track_message(sent)

    async def track_incoming(update, context):
        if await allowed(update) and update.effective_message:
            service.store.track_message(update.effective_message)

    async def handler(update: Update, context: ContextTypes.DEFAULT_TYPE):
        if not await allowed(update):
            if update.callback_query:
                await update.callback_query.answer("Private bot", show_alert=True)
            return
        query = update.callback_query
        if query:
            await query.answer()
            parts = query.data.split()
        else:
            parts = (update.effective_message.text or "").split()
        if not parts:
            return
        command = parts[0].lstrip("/").split("@")[0].lower()
        args = parts[1:]
        if context.user_data.get("connecting") and not query and not parts[0].startswith("/"):
            command, args = "connect", [parts[0]]
        if command in {"start", "help"}:
            await reply(update, HELP, menu())
            return
        if command == "cancel":
            context.user_data.pop("connecting", None)
            await reply(update, "Setup cancelled.", menu())
            return
        if command not in COMMANDS and command != "confirm_disconnect":
            await reply(update, "Use /status for the latest reading, or choose a button below.", menu())
            return
        try:
            if command == "clear":
                tracking_key = f"chat_messages:{config.owner}"
                records = service.store.get(tracking_key, {})
                cutoff = (datetime.now(DHAKA) - timedelta(hours=48)).timestamp()
                ids = [int(key) for key, stamp in records.items() if stamp > cutoff]
                # Also attempt recent private-chat IDs from before tracking was installed.
                latest = update.effective_message.message_id
                ids = sorted(set(ids) | set(range(max(1, latest - 999), latest + 1)), reverse=True)
                failed = False
                for offset in range(0, len(ids), 100):
                    batch = ids[offset : offset + 100]
                    try:
                        await context.bot.delete_messages(chat_id=config.owner, message_ids=batch)
                    except BadRequest:
                        # One old or service message must not block newer messages.
                        for ident in batch:
                            try:
                                await context.bot.delete_message(chat_id=config.owner, message_id=ident)
                            except BadRequest:
                                continue
                            except TelegramError:
                                failed = True
                                break
                        if failed:
                            break
                    except TelegramError:
                        failed = True
                        break
                    remaining = service.store.get(tracking_key, {})
                    for ident in batch:
                        remaining.pop(str(ident), None)
                    service.store.set(tracking_key, remaining)
                # Send directly: the command being replied to may now be deleted.
                sent = await context.bot.send_message(
                    chat_id=config.owner,
                    text=(
                        "Some messages could not be cleared. Try /clear again."
                        if failed
                        else "Finished clearing eligible recent messages (up to 1,000 previous IDs plus tracked messages)."
                    )
                    + "\nTelegram may keep messages older than 48 hours. For the entire chat, use Clear History. Meter records and settings are kept.",
                )
                service.store.track_message(sent)
                return
            if command == "connect":
                if not args:
                    context.user_data["connecting"] = True
                    await reply(
                        update,
                        "Send your DESCO account number here. Use the account number on your receipt, not the meter serial. /cancel to cancel.",
                    )
                    return
                account = args[0].strip()
                if not re.fullmatch(r"\d{5,20}", account):
                    raise ValueError("Enter a 5–20 digit DESCO account number.")
                await reply(update, "Validating your account and fetching the available records…")
                await service.connect(account)
                context.user_data.pop("connecting", None)
                await reply(
                    update,
                    "Connected ✅ Historical recharges establish the baseline; new ones will trigger updates.\n"
                    "Choose /schedule to enable scheduled summaries. Monitoring runs every "
                    f"{config.poll_seconds // 60} minute(s).",
                    menu(),
                )
                await reply(update, status(service.bundle(), config.stale_hours))
                return
            p = service.store.get("profile")
            if not p:
                raise ValueError("Connect first using /connect ACCOUNT_NUMBER.")
            if command == "usage_history":
                month = datetime.now(DHAKA).date().replace(day=1)
                if args:
                    if len(args) != 1 or not re.fullmatch(r"\d{4}-\d{2}", args[0]):
                        raise ValueError("Use /usage_history or /usage_history YYYY-MM.")
                    try:
                        month = datetime.strptime(args[0], "%Y-%m").date()
                    except ValueError:
                        raise ValueError("Choose a valid month: /usage_history YYYY-MM.") from None
                await reply(update, "Checking the month's records…")
                history, end = await service.usage_history(month)
                text = usage_history(history, month, end)
                chunk = ""
                for line in text.splitlines():
                    if len(chunk) + len(line) > 3500:
                        await reply(update, chunk)
                        chunk = "📒 Usage history (continued)\n"
                    chunk += line + "\n"
                if chunk.strip():
                    await reply(update, chunk.strip())
                return
            if command == "disconnect":
                await reply(
                    update,
                    "Delete this account, stored readings, schedules and pending messages from this installation? Previously sent Telegram messages and external backups remain.",
                    InlineKeyboardMarkup(
                        [
                            [
                                InlineKeyboardButton(
                                    "Delete my local records", callback_data="confirm_disconnect"
                                )
                            ]
                        ]
                    ),
                )
                return
            if command == "confirm_disconnect":
                async with service.lock:
                    service.store.disconnect()
                context.user_data.clear()
                await reply(update, "Local meter records and settings deleted. /connect to set up again.")
                return
            if command in {"pause", "resume"}:
                p["paused"] = command == "pause"
                service.store.set("profile", p)
                service.store.clear_pending()
                if command == "resume" and service.store.get("schedule"):
                    service.store.set("schedule_enabled", utcnow())
                await reply(
                    update,
                    "Automatic messages paused. Collection continues; commands still work."
                    if p["paused"]
                    else "Automatic messages resumed. Next scheduled slot applies.",
                )
                return
            if command == "schedule":
                if not args:
                    existing = service.store.get("schedule")
                    info = (
                        f"Next report: {next_slot(existing, datetime.now(DHAKA)):%d %b %Y %H:%M %Z}"
                        if existing
                        else "Reports are currently off."
                    )
                    await reply(
                        update,
                        info
                        + f"\nTimezone: {p['timezone']}\nCustom: /schedule daily 08:00 or /schedule weekly fri 20:00",
                        InlineKeyboardMarkup(
                            [
                                [InlineKeyboardButton("Daily 8 AM", callback_data="schedule daily 08:00")],
                                [
                                    InlineKeyboardButton(
                                        "Friday 8 PM", callback_data="schedule weekly fri 20:00"
                                    )
                                ],
                                [InlineKeyboardButton("Off", callback_data="schedule off")],
                            ]
                        ),
                    )
                    return
                value = parse_schedule(args, p["timezone"])
                service.store.set("schedule", value)
                service.store.set("schedule_enabled", utcnow())
                service.store.cancel_pending("report:")
                await reply(
                    update,
                    f"Next report: {next_slot(value, datetime.now(DHAKA)):%d %b %Y %H:%M %Z}"
                    if value
                    else "Scheduled summaries disabled. Alert settings are unchanged.",
                )
                return
            if command == "alerts":
                if not args:
                    await reply(
                        update,
                        f"Recharge: {p['alerts']['recharge']}\nMismatch: {p['alerts']['mismatch']}\nLow balance: {p['alerts']['low']}\n"
                        "Change with /alerts low 200, /alerts low off, /alerts recharge on/off, /alerts mismatch on/off.",
                    )
                    return
                if len(args) != 2 or args[0] not in {"low", "recharge", "mismatch"}:
                    raise ValueError(
                        "Use /alerts low 200 or /alerts recharge on/off or /alerts mismatch on/off"
                    )
                kind, value = args
                if kind == "low":
                    if value != "off" and (not value.isdigit() or not 1 <= int(value) <= 100000):
                        raise ValueError("Low balance threshold: 1–100000 taka, or off.")
                    p["alerts"][kind] = None if value == "off" else value
                else:
                    if value not in {"on", "off"}:
                        raise ValueError("Choose on or off.")
                    p["alerts"][kind] = value == "on"
                service.store.set("profile", p)
                if value == "off":
                    prefixes = {
                        "low": ["low:"],
                        "recharge": ["recharge:", "recharge-update:", "recharge-balance:"],
                        "mismatch": ["receipt-audit:", "balance-audit:"],
                    }
                    for prefix in prefixes[kind]:
                        service.store.cancel_pending(prefix)
                    if kind == "recharge":
                        service.store.set("pending_recharges", {})
                await reply(update, "Alert preference saved.")
                return
            if command == "settings":
                if args:
                    if len(args) != 2 or args[0] != "timezone":
                        raise ValueError("Use /settings timezone Asia/Dhaka")
                    try:
                        ZoneInfo(args[1])
                    except ZoneInfoNotFoundError:
                        raise ValueError("Unknown timezone. Example: Asia/Dhaka") from None
                    p["timezone"] = args[1]
                    service.store.set("profile", p)
                    schedule = service.store.get("schedule")
                    if schedule:
                        schedule["timezone"] = args[1]
                        service.store.set("schedule", schedule)
                        service.store.set("schedule_enabled", utcnow())
                        service.store.cancel_pending("report:")
                await reply(
                    update,
                    f"Account: {masked(p['account'])}\nTimezone: {p['timezone']}\nPaused: {p['paused']}\n"
                    f"Polling: {config.poll_seconds // 60} minute(s)\nTariff category: {p.get('category') or 'Unavailable'}\n"
                    "Private access: only your configured Telegram ID.\nUse /schedule or /alerts to change delivery.",
                )
                return
            await reply(update, "Checking DESCO…")
            bundle = (
                await service.refresh(force=True)
                if command in {"status", "today"}
                else await service.refresh()
            )
            today = datetime.now(DHAKA).date()
            if command == "status":
                await reply(update, status(bundle, config.stale_hours), menu())
            elif command in {"today", "week", "month"}:
                end = today - timedelta(days=1) if command == "week" else today
                start = (
                    end - timedelta(days=6)
                    if command == "week"
                    else (today.replace(day=1) if command == "month" else today)
                )
                await reply(update, period(bundle, start, end))
            elif command in {"recharges", "history"}:
                rows = sorted(bundle["recharges"], key=lambda r: str(r.get("rechargeDate", "")), reverse=True)
                if "recharges" in bundle["cached"] or "recharges" in bundle["unavailable"]:
                    await reply(update, "⚠️ Recharge refresh failed. Any receipts below are saved records.")
                if not rows:
                    await reply(update, "No recharge records available in the fetched 35-day window.")
                if command == "recharges" and rows:
                    await reply(
                        update,
                        receipt(
                            rows[0],
                            bundle["balance"],
                            recharges=rows
                            if "recharges" not in bundle["cached"]
                            and "recharges" not in bundle["unavailable"]
                            else None,
                        ),
                    )
                elif command == "history" and rows:
                    from .accounting import money

                    lines = ["📜 Recharge history — fetched 35-day window", "Paid → energy credit"]
                    for row in rows:
                        lines.append(
                            f"{row.get('rechargeDate', 'Date missing')} · {money(row.get('totalAmount'))} → {money(row.get('energyAmount'))} · {row.get('orderStatus', 'Status missing')}"
                        )
                    for start in range(0, len(lines), 15):
                        await reply(update, "\n".join(lines[start : start + 15]))
            elif command == "audit":
                await reply(update, service.audit(bundle))
            elif command == "export":
                output = BytesIO()
                text = StringIO(newline="")
                writer = csv.DictWriter(text, fieldnames=["date", "units", "cost", "note"])
                writer.writeheader()
                writer.writerows(daily_deltas(bundle["daily"]))
                with ZipFile(output, "w", ZIP_DEFLATED) as archive:
                    archive.writestr("daily.csv", text.getvalue().encode("utf-8-sig"))
                    archive.writestr(
                        "financial-evidence.json",
                        json.dumps(service.store.records(), ensure_ascii=False, indent=2),
                    )
                    archive.writestr("audit.txt", service.audit(bundle))
                    archive.writestr(
                        "README.txt",
                        "Financial fields only; names, address, phone and recharge tokens are excluded.\n"
                        "Contains account/meter identifiers: keep private. Source fetch times are not meter reading times.\n"
                        "Export capped at most recent 20000 distinct evidence responses. Daily CSV is the current reporting window.\n"
                        "No independent meter accuracy or legal determination.\n",
                    )
                output.seek(0)
                sent = await update.effective_message.reply_document(
                    output,
                    filename=f"descobuddy-{today}.zip",
                    caption="Private financial evidence export. Keep this file safe.",
                )
                service.store.track_message(sent)
        except (ValueError, DescoError) as exc:
            await reply(update, str(exc))
        except Exception as exc:
            logging.getLogger(__name__).error("Command failed (%s)", type(exc).__name__)
            await reply(
                update,
                "This request could not finish. Your saved records are retained; please retry. /status will label any cached readings.",
            )

    async def errors(update, context):
        exc = context.error
        logging.getLogger(__name__).error("Telegram error (%s)", type(exc).__name__)
        if isinstance(exc, Conflict):
            logging.getLogger(__name__).error(
                "Another installation is polling this bot token. Run only one instance."
            )
        elif isinstance(exc, NetworkError):
            logging.getLogger(__name__).warning("Telegram network unavailable; library will retry polling.")

    builder = ApplicationBuilder().post_init(startup).post_shutdown(shutdown)
    builder = (
        builder.bot(bot)
        if bot
        else builder.token(config.token).request(telegram_request()).get_updates_request(telegram_request())
    )
    app: Application = builder.build()
    app.add_handler(MessageHandler(filters.ALL, track_incoming), group=-1)
    for name in COMMANDS:
        app.add_handler(CommandHandler(name, handler))
    app.add_handler(
        CallbackQueryHandler(
            handler,
            pattern=r"^(status|today|recharges|history|usage_history|audit|schedule|alerts|confirm_disconnect)( |$)",
        )
    )
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, handler))
    app.add_error_handler(errors)
    return app
