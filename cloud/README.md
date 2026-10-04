# Zeus DescoBuddy cloud edition

Public, private-chat Telegram bot for Cloudflare Workers Free and D1. No PC,
Docker server or purchased domain is needed. The existing Python application
in the parent folder remains a separate private/local edition.

## What is implemented

- Per-Telegram-user profiles, account/meter validation and isolated data.
- AES-GCM encrypted profiles/readings/outbox, bound to the user ID. D1 stores
  user/message IDs and scheduling timestamps as metadata; names, addresses,
  phone numbers and recharge tokens are discarded.
- Webhook-secret validation, update deduplication, per-user processing leases,
  command throttling and a persistent notification outbox.
- Status, today/week/month, last recharge, recharge history, grouped monthly
  usage history, receipt/balance arithmetic, JSON export, alerts and schedules.
- Decimal cost calculations. Average price/kWh is not an independently verified
  tariff. Missing readings stay pending; cached readings are labelled.
- Recharge/low-balance/receipt-mismatch notifications, later balance updates,
  newly published reading notices, daily/weekly reports and follow-ups when
  previously missing readings arrive.
- English and Bangla Telegram messages via `/language en` and `/language bn`,
  with bold headings and labels. New users receive alerts at ৳500, ৳300 and
  ৳200 as DESCO's reported balance crosses those amounts.
- `/clear` attempts recent messages (at most 1,000 IDs, with a bounded fallback).
  Telegram cannot delete the whole old chat through the Bot API.

Public onboarding requires `/connect ACCOUNT_NUMBER METER_NUMBER`. This checks
that DESCO returns the matching pair, not independent legal ownership. Only
connect a meter you own or are authorized to manage. No user's meter is the
default for another user, including the original operator's account.

## Use the Telegram bot

Open [@Zeus1810_bot](https://t.me/Zeus1810_bot), tap Start, then send:

```text
/connect YOUR_ACCOUNT_NUMBER YOUR_METER_NUMBER
/status
/language bn
```

Both numbers appear in DESCO's customer information or on a recharge receipt.
The first number is the account number; the second is the meter serial. Every
Telegram user connects their own pair. `/status` fetches DESCO's latest online
balance and prints its reading time; it may not be the physical meter's instant
balance. `/today` falls back to the latest available complete day.

The bot monitors for new DESCO balance/daily records and new recharge receipts
throughout the day. The message names the date or timestamp of the newly
published record; it does not claim that the reading happened when the message
arrived. Background checks target 15 minutes but can be slower at capacity.

Useful commands:

| Command | Result |
|---|---|
| `/status`, `/today`, `/week`, `/month` | Balance and dated usage costs |
| `/recharges`, `/history` | Latest recharge or recent recharge history |
| `/usage_history [YYYY-MM]` | Recharges, deductions, and daily costs for a month |
| `/audit` | Receipt arithmetic and cautious balance comparison |
| `/schedule daily 08:00` | Daily report at the chosen Dhaka time |
| `/schedule weekly fri 20:00` | Weekly report on Friday |
| `/schedule off` | Stop timed reports; change alerts separately |
| `/alerts low default` | Restore ৳500, ৳300, ৳200 thresholds |
| `/alerts low 600`, `/alerts low off` | Set one custom threshold or stop low-balance alerts |
| `/alerts recharge on/off`, `/alerts mismatch on/off` | Change receipt alerts |
| `/language bn`, `/language en` | Choose Bangla or English messages |
| `/pause`, `/resume` | Stop or resume automatic messages |
| `/settings`, `/export`, `/clear`, `/disconnect confirm` | Settings, data copy, recent chat clearing, data removal |

`/clear` can remove only recent messages allowed by Telegram, not an entire old
chat. To remove older messages use Telegram's Clear History. Commands still
work while automatic messages are paused.

## Free capacity and current limits

Default maximum: 50 registered users, 2 users checked per minute, 15-minute
target polling interval. At 50 active users, one background round takes about
25 minutes plus failures/retries; notifications are not instantaneous. Commands
request current DESCO data, with a 30-second cache and per-user command throttle.
Daily reports catch up after their chosen Bangladesh time. Users choose daily
or weekly delivery. The cloud edition currently uses Asia/Dhaka only.

Worker/D1 quotas still apply and a free plan does not guarantee uptime. Start
small and observe actual CPU time, subrequests and D1 usage before increasing
MAX_USERS or CRON_BATCH (capped at 2). Free CPU limits must be verified after
real deployment. No artificial keep-alive traffic is used.

Notifications are retried from the outbox. A crash after Telegram accepts a
message but before its outbox record is removed can cause a duplicate. Update
deduplication is retained for 7 days. Message tracking is retained for 48 hours.
The export covers cached financial readings, not the Python edition's full
historical evidence archive. On-demand older months are fetched from DESCO.

## One-time setup on Windows CMD

Prerequisites: Node 22+, a free Cloudflare account, and the existing local .env
containing your Telegram bot token. Do not paste credentials in chat or GitHub.

```cmd
cd /d D:\DownLoadF\DescoBuddy\cloud
npm ci
npx wrangler login
npm run setup
```

Setup reuses or creates one D1 database, applies migrations, deploys the Worker,
and uploads secrets. It creates **cloud/.cloud-secrets.json**, which is ignored
by Git. Back this file up privately. Losing DATA_KEY makes encrypted records
unreadable; never regenerate it for an existing populated database.

The worker has no Telegram webhook until the next step. Stop the CMD polling
bot, then register the webhook using the workers.dev URL shown in Cloudflare:

```cmd
npm run activate -- https://zeus-descobuddy.YOUR-SUBDOMAIN.workers.dev
```

Activation first verifies D1, DESCO HTTPS, and Telegram from the deployed Worker.
It does not change the webhook if that check fails. DESCO previously omitted an
intermediate certificate, so this remote check is essential. Verification is
never disabled. After activation, verify `/start`, `/connect ACCOUNT METER`,
`/status`, a scheduled report and a second Telegram user's isolation.

The old local database is preserved and is not uploaded. Reconnect your meter
in the cloud bot. Current DESCO records will be fetched afresh. Migrating the
local historical evidence archive is not part of this implementation.

## CI/CD

GitHub Actions runs tests and bundles the Worker on pushes/PRs. Production
deployment runs on main only after the following repository variables exist:

- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_D1_DATABASE_ID` (setup prints the database UUID)

Add repository secret `CLOUDFLARE_API_TOKEN`: restrict it to this Cloudflare
account with Workers Scripts Edit and D1 Edit. Account read permissions may be
needed for Wrangler account discovery. Do not put the bot token or DATA_KEY in
GitHub; the workflow preserves existing Worker secrets. If using GitHub's
production environment approvals, deployments wait for those approvals.

The workflow applies additive D1 migrations then deploys. It does not provision
paid resources or activate the webhook. Production stays unconfigured until
the owner's Cloudflare authentication and initial setup are completed.

## Development and verification

```cmd
npm ci
npm run check
npm test
```

Tests use synthetic records, simulated DESCO/Telegram responses, and a real
local Miniflare Worker/D1. They do not contact real Telegram users. `/health`
is public and contains no customer information. `/ready` requires the webhook
secret. It checks connectivity, not meter accuracy or schedule delivery.

Use `wrangler d1 export zeus-descobuddy --remote --output PRIVATE_BACKUP.sql`
for private database backups and retain DATA_KEY separately. Never commit
backups. To roll back code, use Cloudflare deployment rollback or redeploy a
known good commit. Rollback does not undo D1 migrations; do not drop columns or
tables while old versions might need them.

## Sources

- https://developers.cloudflare.com/workers/platform/pricing/
- https://developers.cloudflare.com/workers/platform/limits/
- https://developers.cloudflare.com/d1/reference/faq/
- https://core.telegram.org/bots/api#setwebhook
