# Cloud system design

## Scope and assumptions

The public bot serves private Telegram chats only. A user links one DESCO
account/meter pair, asks for on-demand reports, and receives notices when
DESCO publishes new readings or recharges. It does not control the meter,
initiate payment, provide a live physical-meter balance, or prove meter
ownership. The initial free-tier target is at most 50 registered profiles,
not unbounded public scale.

```text
Telegram -> authenticated webhook -> Worker -> D1 encrypted user state
                                     |       -> durable outbox -> Telegram
                                     +-------> DESCO HTTPS endpoints
Cloudflare cron -> due-user lease -> DESCO refresh -> event dedup -> outbox
```

The Worker handles one user's commands and scheduled refreshes under a D1
lease. `updates` deduplicates Telegram retries; the encrypted outbox retains
unsent notices. A successful send followed by a crash before outbox deletion
can still duplicate a message. There is no claim of exactly-once delivery.

For daily notices, a pair of consecutive midnight balance readings gives a
provisional spend for the intervening day: previous balance + confirmed net
recharge credit - new balance. Only a matching meter, consecutive dates, fresh
receipt history and nonnegative result qualify. The reading notice includes
this estimate and the DESCO reading time. The later DESCO daily record is
reconciled silently when it agrees, or produces a cautious difference notice
when it does not. If an estimate is unsafe, the bot sends the balance notice
without claiming a daily cost; the actual daily record may then arrive as a
separate notice. A balance change can include fees, corrections or late
recharges, so the estimate never proves tariff or meter accuracy.

## Capacity budget

At 50 connected users and a 15-minute desired interval, fully meeting the
target would require 50 × 96 = 4,800 user refreshes/day. The configured cron
limit is two users/minute, at most 2,880 refreshes/day, so a full queue takes
at least 25 minutes per round even before upstream latency. Each refresh may
make roughly 3–5 DESCO HTTPS calls, depending on the date range: at most about
14,400 upstream calls/day at the configured cron ceiling, plus manual calls.
This is a planning bound, not a measured DESCO quota or availability promise.

The bottlenecks are DESCO's undocumented upstream capacity, D1 row writes,
and the free Worker execution budget. Keep `MAX_USERS=50` and `CRON_BATCH=2`
until production metrics support a change. On-demand refreshes use a
30-second per-user cache; older monthly reports fetch their requested month.
Due-user selection is indexed in D1. The persistent outbox is the async
delivery boundary; adding a second queue is unnecessary at this scale.

## Failure and scaling rules

- If one DESCO endpoint fails, keep the last good value and label it stale or
  unavailable. Never call an old reading an instant balance.
- If Telegram delivery fails, keep the outbox record for retry. Keep message
  volume bounded by event deduplication and a five-message drain batch.
- If D1 is unavailable or quota-exhausted, webhook work fails with a retryable
  response; inspect Cloudflare D1 metrics before raising capacity.
- If demand grows, measure observed refresh latency, D1 row reads/writes,
  Worker errors and Telegram webhook backlog first. Increase cron throughput
  only after load testing and checking free-tier subrequest/CPU headroom.
- DESCO and Telegram are external single points of failure; there is no
  independent, trustworthy replacement source for their data.

Use the Cloudflare Worker request/error/CPU dashboard, D1 Row Metrics, and
Telegram `getWebhookInfo` to watch traffic, quota headroom and pending
updates. Before deploying: run tests and a Worker dry-run. After deploying:
check `/health`, the authenticated `/ready` probe, then one real `/status`
from an authorized meter. Roll back the Worker code if errors rise; D1
migrations must remain backward-compatible. Back up D1 and the separate
`DATA_KEY` before schema changes. The [cloud guide](../cloud/README.md)
contains the deployment steps.

## Design diagnostic

Current score: **9/10 (7 of 8)**. Requirements, capacity estimate, bounded
database strategy, short-lived cache, async outbox, monitoring plan and
deployment/rollback plan are explicit. The missing row is full component
redundancy: DESCO and Telegram are independent external services with no
equivalent failover. The safe fix is not to invent readings; retain and label
cached data, retry later, and revisit hosting/data sources if the project's
availability requirement becomes stricter.

Cloudflare's current free-tier Worker and D1 quotas are documented in its
[Worker pricing](https://developers.cloudflare.com/workers/platform/pricing/)
and [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/).
