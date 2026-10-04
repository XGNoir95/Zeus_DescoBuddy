# Security and abuse controls

## Trust boundaries

Only HTTPS `POST /telegram` accepts Telegram updates. The webhook secret is
checked before the body is read or D1 is touched. Only a private chat whose
Telegram user ID equals the chat ID is accepted. Group messages are ignored.
The body reader stops at 64 KiB even when `Content-Length` is absent. D1
updates are deduplicated, and each user's lease prevents concurrent edits.

Profiles, readings and queued messages are AES-GCM encrypted with a secret
`DATA_KEY`, bound to the Telegram user ID. The key and bot token are Worker
secrets, not repository files or GitHub deployment variables. D1 still stores
user IDs, message IDs and scheduling metadata in plaintext. Telegram copies
and downloaded exports are outside D1 encryption.

## Abuse budgets

| Boundary                                                            | Limit                                                 | Response                                                                      |
| ------------------------------------------------------------------- | ----------------------------------------------------- | ----------------------------------------------------------------------------- |
| Authenticated updates, per Telegram user                            | 12/minute                                             | Acknowledge and drop excess without a reply                                   |
| Costly commands (`/connect`, `/usage_history`, `/clear`, `/export`) | 3/minute per user                                     | Acknowledge and drop excess                                                   |
| New-user admission                                                  | 5/minute per Cloudflare location                      | Acknowledge and drop excess                                                   |
| Normal command spacing                                              | 3 seconds per user                                    | Short wait message                                                            |
| User count                                                          | 50 stored profiles                                    | Capacity message; unconnected/disconnected profiles expire after 6 hours idle |
| DESCO refresh                                                       | 30-second cache per user                              | Reuse latest fetched snapshot                                                 |
| Background work                                                     | 2 due users/minute                                    | Backlog delays notices rather than unbounded fan-out                          |
| `/clear`                                                            | At most 1,000 recent message IDs; 10 fallback deletes | Stop if Telegram rejects further deletion                                     |

The Cloudflare Worker rate-limit counters are **per location and eventually
consistent**, so these are protective budgets, not exact global accounting.
Telegram gets HTTP 200 for a dropped over-limit update; returning 429/503
would make Telegram retry the same flood. A normal user who sends many
commands quickly can retry after one minute. The unauthenticated `/health`
response contains no private information; `/ready` requires the secret.

These controls protect D1 and DESCO after a request reaches the Worker. They
cannot prevent a network-scale request flood from consuming the free Worker's
daily invocation quota on a public `workers.dev` URL. A custom Cloudflare
zone with a WAF rule is a possible future edge-level control if this grows;
it is not currently configured. Account/meter matching is not proof of legal
ownership; DESCO provides no additional authentication through this flow.

## Operations and incident response

1. Watch Worker request/error/CPU metrics, D1 row usage, and Telegram webhook
   `pending_update_count` and `last_error_message`. Avoid logging tokens,
   account numbers, raw updates or financial responses.
2. If command abuse rises, inspect which budget is hit and whether ordinary
   users are affected before changing limits. Do not turn off authentication.
3. If the webhook secret or bot token leaks, rotate it through Cloudflare
   secrets and re-register the Telegram webhook. Do not commit replacement
   secrets. If `DATA_KEY` leaks, plan an encrypted data migration; blindly
   replacing it makes existing D1 records unreadable.
4. If free-tier quotas are exhausted, lower user/cron throughput or wait for
   the quota reset. Do not claim fresh readings while DESCO or D1 is down.
5. Back up D1 and `DATA_KEY` separately in private storage and test restore
   steps before changing schema. Never commit exports or SQL backups.

Reference: [Cloudflare Worker rate-limit behavior](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/),
[D1 free limits](https://developers.cloudflare.com/d1/platform/pricing/), and
[Telegram webhook semantics](https://core.telegram.org/bots/api#setwebhook).
