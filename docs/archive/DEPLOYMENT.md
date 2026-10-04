# Archived deployment preparation (local Python edition)

For the live Cloudflare bot, use `cloud/README.md` from the repository root.

The public Cloudflare implementation and CI/CD workflow are in `cloud/`.
Follow [cloud/README.md](cloud/README.md) for authentication, deployment,
webhook activation, capacity limits and tests. Live activation requires the
owner's Cloudflare account. The Python implementation described below remains
restricted to OWNER_TELEGRAM_ID and can be run as a separate fallback.

## Selected requirements

The user requires no-card free hosting and open registration: each Telegram
user connects their own meter in a private chat. Cloudflare Workers Free + D1
is the proposed target. Cloudflare advertises no-card signup for Workers.
This is a migration, not a Docker deployment: Telegram webhooks replace polling,
D1 replaces local SQLite, and Cron Triggers replace the persistent scheduler.
The Docker instructions below remain an alternative for a conventional server.

Cloud implementation requirements (implemented locally; verify live before cutover):

- All account data, schedules, exports, notifications and deletion operations
  are scoped to the authenticated Telegram user ID, never a global owner.
- Verify Telegram's webhook secret; deduplicate updates and prevent concurrent
  requests from overwriting each other's account settings.
- Require a user's own account/meter details; the existing public DESCO lookup
  does not independently prove ownership. Never expose the owner's saved meter
  as a default account to new users.
- Preserve the tested Decimal accounting/report behavior and distinguish
  measured balances from credit estimates.
- Check DESCO HTTPS access from the actual Worker, particularly the incomplete
  certificate chain previously observed on Windows. Do not disable verification.
- Enforce request/polling limits; batch scheduled checks within Workers/D1 free
  quotas. The free plan is not an unlimited-user or guaranteed-uptime service.
- Persist notification deduplication and scheduling state in D1; do not depend
  on a warm process. Test cross-user isolation and webhook replay handling.
- Verify a real Telegram round trip before stopping the local installation.
  Switch from polling to webhook only at cutover, with a rollback plan.

Worker/database creation needs the user's Cloudflare account. The repository
is https://github.com/XGNoir95/Zeus_DescoBuddy.

References:
https://www.cloudflare.com/products/workers/
https://developers.cloudflare.com/workers/platform/pricing/
https://developers.cloudflare.com/d1/reference/faq/

## Hosting requirements

This Python bot runs continuously using Telegram polling and a scheduler.
It needs a Linux host with Docker Compose, outgoing HTTPS, and persistent disk.
It needs no public web port or domain. The existing Compose configuration uses
a named volume for readings, schedules and encryption keys and restarts the
container after a reboot, provided Docker is enabled at boot.

Free hosting has quotas and availability limits. Oracle Always Free compute
is a possible match, but signup requires payment verification, free capacity
may be unavailable, and idle machines can be reclaimed. Confirm eligibility
in the hosting account before creating resources. Do not create paid resources
or rely on trial credits for a permanent free installation.

Render's free web service sleeps and lacks persistent local disk; it is not a
drop-in host for this polling/SQLite implementation. A no-card, event-driven
hosting alternative requires a separate webhook and durable database design.

## GitHub

Use a private repository initially. Commit source and deployment files only.
The ignore files exclude .env, data/, virtual environments, databases and keys.
Never upload a data export, Telegram token or SSH private key. The GitHub check
workflow runs offline tests and builds the image without production secrets.
It does not deploy automatically or start a production Telegram bot.

## Server launch (after a provider and access model are selected)

1. Clone the repository on the Linux server and install Docker with Compose.
2. Privately create .env using .env.example as the field reference. Keep file
   permissions restricted to your server user. Do not commit it.
3. Stop the CMD bot before starting cloud polling with the same token.
4. Run `sh deploy.sh` from the checkout.
5. Check logs and scheduler health using the commands printed by that script,
   then verify /status and a scheduled report in Telegram.

Do not run `docker compose down -v`: that deletes the persistent data volume.
Do not run two hosts with the same bot token.

## Existing history and updates

The local data directory contains the database AND its encryption.key. Preserve
both together. A fresh cloud volume starts with no linked account/history.
To migrate, stop the local bot first, privately copy the complete data directory
into the server's bot-data volume, and set ownership for container UID 10001
before launch. Migration must be tested against the final single/multi-user
storage layout; do not upload data to GitHub.

For upgrades, pull the reviewed code and rerun `sh deploy.sh`. Named-volume
data survives image replacement. Back up the full volume while the bot is
stopped; store the backup privately. A cloud disk is not itself a backup.

## Provider references checked 2026-10-04

- https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm
- https://www.oracle.com/cloud/free/faq/
- https://render.com/docs/free
