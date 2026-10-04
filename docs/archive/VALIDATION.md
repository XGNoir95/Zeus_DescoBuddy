# Archived local-edition validation — 3 October 2026

This predates the current cloud hardening work; run the current checks in the
repository root README before relying on a new deployment.

## Passed locally

- 40 automated tests on native Windows Python 3.12.
- Actual `python-telegram-bot` v22.8 command dispatch, owner/private-chat enforcement, command-menu registration, scheduler registration, account connection, status, schedule changes, alerts, audit, document export, pause/resume and confirmed deletion through a mocked Telegram HTTP boundary.
- Money calculations: Decimal precision, signed rebate, missing values, charge aggregation without double-counting, cumulative units, monthly cost reset, gaps, duplicate dates, corrections, and conservative balance comparison.
- Persistence: encrypted database, restart-safe recharge deduplication, queued-message retry, delayed balance follow-up, completed-report follow-up and deletion.
- Partial DESCO failures and regressing meter timestamps preserve and label last-known data.
- Dependency compatibility: `pip check` passed.
- Static checks: Ruff and Python compilation passed.
- Docker Compose configuration validated using `docker compose config --no-env-resolution`.
- Actual HTTPS requests to BOTH `unified` and `tkdes` balance endpoints with intentionally invalid account `0000000000` returned recognized no-account responses. No real customer's information was queried.
- Startup without a token/owner exits with an actionable setup instruction, rather than starting an unrestricted bot.

## Still requires your credentials / deployment environment

- No bot token, Telegram owner ID, or DESCO account has been provided. The bot has NOT authenticated to your real Telegram bot or delivered a live message.
- No authorized real-meter response has been captured. Daily/recharge schema compatibility and day-label interpretation must be checked against your portal after `/connect`.
- Independent tariff audit is deliberately disabled until applicable current official tariff rates/amendments are reviewed and configured. Receipt arithmetic checks and reported costs work without this optional rule file; they cannot certify the legality of a charge.
- Docker Desktop's daemon was unavailable. Compose syntax was validated, but image build/container runtime was not tested here.
- Continuous operation requires an awake host or continuously running server. DESCO outages and delayed readings cannot be eliminated by the bot.

## Activate locally

```powershell
cd D:\DownLoadF\DescoBuddy
.\start.ps1 setup
.\start.ps1 run
```

Then privately message `/connect YOUR_ACCOUNT_NUMBER`, `/status`, `/recharges`, and `/audit`. Compare the reading timestamps and receipt totals with your DESCO portal. Configure `/schedule daily 08:00` or `/schedule weekly fri 20:00` after connection.

Setup uses hidden token input. Never reuse the reference repository's exposed token. See README.md for installation, storage, schedule behavior and calculation limitations.
