# Zeus DescoBuddy

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/zeus-logo-horizontal-dark.png">
  <img alt="Zeus DescoBuddy" src="assets/zeus-logo-horizontal-light.png" width="420">
</picture>

DESCO prepaid balance, recharge and daily-cost updates in Telegram. The public
bot runs on Cloudflare Workers and D1; you do not need to leave a PC on.

**Use it:** open [@Zeus1810_bot](https://t.me/Zeus1810_bot), tap **Start**,
then privately send `/connect ACCOUNT_NUMBER METER_NUMBER`. Use the two numbers
shown in your DESCO account information. Only connect a meter you own or are
authorized to manage. Each Telegram user connects their own meter.

| Command                              | What you get                                                  |
| ------------------------------------ | ------------------------------------------------------------- |
| `/status`                            | Latest DESCO-reported balance and its reading time            |
| `/today`, `/week`, `/month`          | Dated kWh and cost; latest complete day when today is pending |
| `/recharges`, `/history`             | Latest recharge or recent recharge list                       |
| `/usage_history [YYYY-MM]`           | Recharge credits, deductions and daily costs grouped by month |
| `/audit`                             | Receipt arithmetic and cautious balance comparison            |
| `/language bn` or `/language en`     | Bangla or English messages                                    |
| `/schedule daily 08:00`              | Optional daily summary in Bangladesh time                     |
| `/schedule weekly fri 20:00`         | Optional weekly summary                                       |
| `/schedule off`, `/extras off`       | Stop only your optional messages                              |
| `/alerts low 600`, `/alerts low off` | Add or remove a personal low-balance limit                    |
| `/pause`, `/resume`                  | Stop or restart **all** automatic messages                    |
| `/settings`, `/help`                 | Settings and full command help                                |
| `/export`, `/disconnect confirm`     | Download saved data or remove your connected meter            |

By default, the bot checks for newly published readings and recharges and
alerts when DESCO's reported balance falls below **৳500, ৳300 or ৳200**.
When DESCO posts consecutive midnight balances, one reading notice estimates
the previous day's spend from their difference (plus any confirmed net recharge
credit during that day). The later daily kWh record is checked silently; the
bot sends another notice only if the amounts differ. The early amount is an
estimate and may include other charges or adjustments, not just electricity.
Optional schedules and personal alerts can be turned off without stopping
those regular notices. Checks aim for approximately 15 minutes per user, but
can take longer at free-tier capacity. DESCO may publish a reading late; the
bot shows its actual source time. It cannot read the physical meter's instant
balance, prove a tariff is legal, or verify ownership from the DESCO account
and meter pair alone.

## Repository guide

| Path                                           | Purpose                                                       |
| ---------------------------------------------- | ------------------------------------------------------------- |
| [`cloud/`](cloud/)                             | Deployed Worker, D1 schema, tests and setup scripts           |
| [`descobuddy/`](descobuddy/)                   | Original private Python edition; separate from the public bot |
| [`tests/`](tests/)                             | Python-edition tests                                          |
| [`docs/architecture.md`](docs/architecture.md) | System design, capacity and reliability decisions             |
| [`docs/security.md`](docs/security.md)         | Threat boundaries, rate limits and incident steps             |
| [`docs/archive/`](docs/archive/)               | Historical local-edition setup and validation notes           |

See the [cloud guide](cloud/README.md) for deployment, CI/CD, backups and
rollback. The older Python edition is documented in the
[archived guide](docs/archive/README-2026-10-04.md).

## Verify a change

Node.js 22+ is required for the cloud edition:

```sh
cd cloud
npm ci
npm run check
npm test
```

For the separate Python edition, use Python 3.12 and the commands in the
archived guide. Never run the Python polling bot and cloud webhook on the same
Telegram token at the same time.

## Privacy and limitations

Profiles and cached financial data are encrypted in D1, but Telegram messages
and downloaded exports remain readable in your Telegram account and wherever
you save them. Keep exports private. The project does not initiate payments.
Receipt arithmetic is **not** an independent tariff or meter-accuracy audit.
This is a community project, not an official DESCO service.

DESCO's portal endpoints can change without notice. Free hosting has hard
quotas and does not guarantee 24/7 availability under an outage or large
attack. The [security guide](docs/security.md) states the remaining limits.
