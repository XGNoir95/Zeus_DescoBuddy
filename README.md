# Zeus DescoBuddy

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/zeus-logo-horizontal-dark.png">
  <img alt="Zeus logo" src="assets/zeus-logo-horizontal-light.png" width="420">
</picture>

DESCO prepaid meter updates in Telegram, hosted continuously on Cloudflare's
free tier. Each user connects their own account and meter. Open
[@Zeus1810_bot](https://t.me/Zeus1810_bot) to use the public bot; no PC setup is
needed.

## Start in Telegram

1. Open [@Zeus1810_bot](https://t.me/Zeus1810_bot) and tap **Start**.
2. Find your DESCO **account number** and **meter number** on the portal or
   recharge receipt. In the bot's private chat, send
   `/connect ACCOUNT_NUMBER METER_NUMBER` with your own numbers.
3. Send `/status` for the latest balance and reading time. `/today` shows the
   latest available daily cost if DESCO has not published today's record.
4. Send `/language bn` for Bangla messages, or `/language en` for English.

The bot checks connected meters in the background, aiming for about every 15
minutes per user. It sends a short notice when DESCO publishes a new balance or
complete daily reading, with the actual DESCO reading time or usage date. A
recharge notice follows when DESCO publishes a new receipt. It also alerts when
the reported balance first falls below **৳500, ৳300, and ৳200**. Use
`/alerts low default` to restore these limits, `/alerts low 600` for one custom
limit, or `/alerts low off` to disable them. `/pause` stops automatic messages;
`/resume` starts them again.

Use `/schedule daily 08:00` or `/schedule weekly fri 20:00` for a regular
summary (Bangladesh time). `/recharges` shows the latest recharge; `/history`
shows recent recharges; `/usage_history` groups this month's recharge credits
and daily costs. `/audit` checks receipt arithmetic, and `/help` lists all
commands. DESCO's online balance can lag the physical meter, so the bot always
shows the source reading time. Only connect a meter you own or are authorized
to manage.

The [cloud guide](cloud/README.md) covers hosting, development, and backups.
The Python instructions below describe the original private local edition,
which is separate from the public cloud bot.

## Original private Python edition

A private Telegram bot for DESCO prepaid balance, dated consumption, recharge breakdowns and accounting checks. Only the configured Telegram owner can use it, and only in a private chat.

## Start on this computer

An isolated native Windows Python environment is already installed at `.venv-win`.

```powershell
cd D:\DownLoadF\DescoBuddy
.\start.ps1 setup
.\start.ps1 run
```

Setup asks for a **new token from the genuine @BotFather** using hidden input. Open your bot and send `/start` when prompted; setup lists recent private-chat IDs so you can select your own numeric Telegram ID. It validates the token, then saves the token/owner to the ignored `.env` file. If the recent-users list is empty, supply your known numeric ID or rerun setup after sending `/start`. Do not put a token in chat, source control, screenshots, or a command line.

In Telegram:

```text
/start
/connect YOUR_DESCO_ACCOUNT_NUMBER
/status
/schedule daily 08:00
/alerts low 200
```

The DESCO account number is requested inside your private bot conversation. Use the account number from your recharge receipt, not the meter serial. A response from DESCO must validate the account before it is saved. Existing historical recharge records establish a baseline and are not sent as new-recharge notifications.

To check credentials and an already linked account, stop the running process, then use `./start.ps1 doctor`. Only run one bot instance per token. Doctor can refresh local data/queue events but does not send Telegram messages. The bot must remain running on an awake, internet-connected computer or server for automatic updates.

## Fresh installation

Use standard CPython 3.11+ (3.12 recommended), not MSYS/MinGW Python.

```powershell
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.lock
.\.venv\Scripts\python.exe -m pip install --no-deps -e .
.\start.ps1 setup
.\start.ps1 run
```

Linux/macOS:

```sh
python3 -m venv .venv
. .venv/bin/activate
pip install -r requirements.lock
pip install --no-deps -e .
python -m descobuddy setup
python -m descobuddy run
```

You may instead fill `.env` using `.env.example`. Required fields are `TELEGRAM_BOT_TOKEN` and `OWNER_TELEGRAM_ID`. The default timezone is Asia/Dhaka; default monitoring interval is five minutes. On-demand requests fetch again unless another request fetched within the last 30 seconds.

## Commands

| Command | Behavior |
|---|---|
| `/start`, `/help` | Instructions and shortcut buttons |
| `/connect NUMBER` | Validate and privately link one account |
| `/status` | Latest balance, monthly reported cost, DESCO reading time, latest available daily record |
| `/today` | Today's dated consumption if available; never invents intraday usage |
| `/week` | Previous seven calendar dates |
| `/month` | Month-to-date dated readings; incomplete days identified |
| `/recharges` | Latest receipt, itemized deductions, reported balance and a labelled credit calculation while a later reading is pending |
| `/history` | Recharge history from the 35-day fetch window: amount paid, energy credit and status |
| `/clear` | Attempt recent tracked messages and up to 1,000 preceding message IDs in your private chat; keeps meter data/settings. Telegram's 48-hour limit applies. Use Telegram Clear History for the entire chat. |
| `/usage_history [YYYY-MM]` | Monthly recharge/deduction groups and daily kWh × average price calculations; defaults to this month. Fetches the selected month independently of the current live report. |
| `/audit` | Receipt arithmetic, conservative balance comparison, optional tariff estimate |
| `/schedule` | Buttons or `daily 08:00`, `weekly fri 20:00`, `off` |
| `/alerts` | View preferences; `low 200`, `low off`, `recharge on/off`, `mismatch on/off` |
| `/settings` | View settings; `timezone Asia/Dhaka` changes notification timezone |
| `/export` | ZIP containing current daily CSV, stored financial evidence and audit summary |
| `/pause`, `/resume` | Stop/resume automatic messages; collection and manual commands continue |
| `/disconnect` | Button-confirmed deletion of this installation's records and schedules |
| `/cancel` | Cancel interactive connection setup |

The interface is English. A single daily OR weekly schedule can be enabled. Consumption dates always use DESCO's Dhaka dates; the notification timezone controls delivery only. No payments are initiated.

## What the bot actually verifies

**Daily consumption:** the current DESCO portal JavaScript treats `consumedUnit` as cumulative units and `consumedTaka` as a monthly cumulative amount. DescoBuddy differences consecutive dated records, with a cost reset on the first of the month. Missing predecessors, conflicting duplicates, counter decreases and meter changes are flagged, not filled with zeros. The source only labels dates; it does not establish exact midnight readings or second-by-second usage.

**Recharge receipt arithmetic:** gross amount is compared with energy credit + VAT + signed rebate + other charges. DESCO generally expresses a rebate as a negative deduction. `chargeItems[].value` is summed, or `chargeAmount` is used as an aggregate, never both. Missing/unknown fields leave the check incomplete. Duplicate VAT/rebate fields are not guessed. Payment-app service fees outside DESCO receipts require separate receipts and are not included.

**Balance consistency:** compare two advancing, same-month readings: opening balance minus closing balance versus the reported monthly cost increase. Comparisons are withheld when recharge history is unavailable, a recharge is near the interval, a meter changes, or a monthly counter resets. Receipt creation time does not prove the time credit actually reached the meter. A candidate discrepancy is not a proven overcharge, even after repeated polling. An internally matching result does not establish tariff correctness.

**Independent tariff checks:** a tariff calculation engine exists, but no unverified current rates are enabled. Until an independently reviewed tariff matching the account category and effective period is supplied, `/audit` explicitly says this check is unavailable. Full-month-to-date, consecutive unit records are also required. Actual rent, demand charges, VAT, and rebates are shown from receipts; their legal correctness is NOT automatically certified. DESCO PDFs include amendments, so an old FAQ's example rate must not be treated as a current tariff.

**Physical meter accuracy:** DESCO's endpoints and portal share the same source. Their agreement is not independent evidence of physical kWh accuracy. That requires independent measuring equipment or a meter test.

## Notifications and reliability

- Polling defaults to five minutes. Recharge notifications depend on DESCO publishing the transaction, so they are not instant push events.
- Notifications include gross paid, net credit on the receipt, deductions, receipt status, and current available balance with reading time.
- If the balance reading predates a recharge, the bot follows up when a later reading arrives. It does not label a balance jump as the exact credited amount.
- For a recent balance and complete fetched recharge history, a separate calculation adds subsequent successful energy credits. This assumes meter delivery and excludes unreported consumption/other deductions; it is not an exact current or immediate post-recharge balance.
- Both portal charge schemas are supported: `name`/`value` and tkdes `chargeItemName`/`chargeAmount`.
- Stable order IDs identify recharges. Rows without order IDs remain visible in reports but do not produce automatic new-transaction notifications.
- Updates to an existing receipt produce a separate record-update notification.
- All settings, seen transactions, evidence and outgoing notifications survive restarts in SQLite. Schedules catch up to the latest due slot once, not every missed day.
- If a scheduled report is incomplete, it is followed up when all required dates become available within the same scheduled slot. Earlier missed slots are not replayed indefinitely; use `/week` or `/export` for history.
- Low balance alerts have a 24-hour cooldown. Receipt/candidate-balance alerts are deduplicated by their evidence.
- Outgoing messages retry after failure. There is a narrow unavoidable case where Telegram receives a message but the process stops before saving the acknowledgement: a duplicate may be sent on restart. Telegram has no application-level exactly-once send guarantee.
- Balance, daily and recharge requests can fail independently. Last successful data is labelled cached; absent data is labelled unavailable. No fallback scraper claims an independent source.
- Portal JavaScript checked on 2026-10-03 uses the same host and balance/daily/recharge endpoints as this adapter. Scraping its rendered views cannot produce an unpublished daily record or newer balance. An empty daily period shows a pending total and the latest complete dated record, rather than a zero subtotal.
- Consumption shows kWh × average price/kWh ≈ daily cost. This average is calculated from DESCO's cost divided by units, rounded to four decimals; it is not an independently verified tariff. Pending today reports include the latest complete dated cost.
- Chat message IDs are tracked locally, including commands, replies, exports and automatic notifications. `/clear` also attempts a bounded range of up to 1,000 preceding IDs to cover messages before tracking was installed. Missing IDs are skipped by Telegram; rejected batches fall back to individual deletions. Telegram limits deletion to messages under 48 hours old. A short confirmation remains after clearing.
- `/status` and `/today` explicitly refresh their sources and show the usage fetch time. Existing Telegram replies are snapshots and do not change when a later request gets newer data.
- Usage-history groups are calendar intervals from a recharge date to the day before the next recharge date. Same-day recharges share the daily section, and days before the first recharge are shown separately. Recharge-day consumption includes time before payment; receipt credit is not proof of exact meter delivery or which recharge funded each day's usage. Missing days remain pending, excluded from subtotals.
- HTTP timeouts and bounded retries protect the event loop. TLS verification stays enabled. Explicit DESCO error codes and empty/invalid responses are validated.
- HTTPS uses both the operating system's trusted roots and the packaged certificate bundle. This was necessary for live DESCO connectivity on this Windows setup; no certificate verification is bypassed.
- Schedules start off; recharge/mismatch alerts default on, low balance defaults to ৳200.

## Storage and privacy

`data/` contains an encrypted SQLite database and `encryption.key`. Identifiers, preferences, cached responses and financial evidence are encrypted with Fernet. SQL metadata such as record type and fetch time is not encrypted. Keep the whole folder private: someone with BOTH the database and key can decrypt it. Back up both together; losing the key makes old records unreadable. A missing key next to an existing database is an error, not silently replaced.

Only financial fields are retained. Names, addresses, phone numbers and recharge tokens are discarded. Encryption does not cover Telegram messages or downloaded exports; these contain private financial information. `/disconnect` removes local rows and compacts the DB, but cannot delete copies in external backups or previously sent Telegram messages. Evidence is retained until disconnect; monitor disk usage for long-running installations. Exports include at most the latest 20,000 distinct evidence responses.

Request logging is suppressed because Telegram tokens and DESCO account numbers appear in URLs. Runtime errors are logged by type, not raw request details. Never reuse the token exposed in the reference GitHub repository.

## Docker

After setting up `.env`, run:

```sh
docker compose up -d --build
docker compose logs --tail=50 bot
```

The container runs as a non-root user, persists its database/key in a named volume, and restarts on process exit. Its health check verifies the scheduler heartbeat, not DESCO freshness. Do not run a host copy with the same token concurrently. Docker uses its own database; connect the meter there after launch. Docker Desktop must be running on Windows. The container configuration is provided; live container execution requires an available Docker daemon.

## Optional tariff configuration

`TARIFF_FILE` may point to a JSON array of reviewed rules, each containing:

```text
category: exact DESCO tariffSolution string
verified: true (only after independently reviewing the official schedule)
source: exact official tariff notice URL
from / to: inclusive effective dates, YYYY-MM-DD
tiers: ordered objects with up_to and rate; final up_to is null
lifeline: optional object with up_to and rate
```

The engine reprices cumulative consumption when the lifeline threshold is crossed. It does not model time-of-use, demand penalties, or every special category. Don't enable it for unsupported schemes. Never fabricate rates merely to enable an audit. Rules with missing provenance/validity are rejected, overlaps yield unavailable, and expired rules are not silently used. This estimate is energy-only; apply current official rounding/tax rules before treating it as a final bill calculation. In Docker mount the rule file read-only and use the container path in `TARIFF_FILE`.

## Verification

```powershell
.\.venv-win\Scripts\python.exe -m pytest -q
.\.venv-win\Scripts\python.exe -m ruff check descobuddy tests tools
.\.venv-win\Scripts\python.exe -m pip check
.\.venv-win\Scripts\python.exe -m tools.smoke
```

On a fresh install, install test tooling with `pip install -e '.[dev]'` and use your environment's Python. Tests cover money precision, cumulative readings, resets/gaps, missing fields, receipts, stale source handling, schedules, encrypted persistence, retry queues, and real python-telegram-bot command dispatch using a mocked Telegram HTTP boundary. The optional live smoke check sends only an intentionally invalid account number; it cannot validate your meter's schema or actual Telegram delivery.

## Sources checked during implementation

- DESCO portal: https://prepaid.desco.org.bd/customer/
- Portal consumption implementation inspected 2026-10-03: https://prepaid.desco.org.bd/customer/js/chunk-ab9120de.cd3119f9.js (`processDailyData`)
- DESCO retail tariffs/amendments: https://desco.gov.bd/pages/static-pages/6922e0fc933eb65569e296ed
- DESCO recharge manual: https://prepaid.desco.org.bd/doc/user_manual_for_prepaid_website.pdf
- Telegram library v22.8: https://docs.python-telegram-bot.org/en/stable/
- Telegram bot setup: https://core.telegram.org/bots/features#botfather

These DESCO-hosted endpoints are used by its portal, but there is no guaranteed public API contract. First live validation with your authorized account is still necessary; upstream changes may require updating the adapter.
