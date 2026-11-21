# Downstream consumers

Work that used to run only at the end of a completed ingestion pass now runs
as independent consumers. Each has its own cron, its own singleton workflow
hook (`downstream-consumer:<name>`), its own checkpoint and its own kill
switch. None waits for a pass to complete, and none calls a search backend
(`src/workflows/downstream-consumers-search.test.ts` checks each consumer's
import graph).

| Consumer               | Cron                                            | Checkpoint                                                  |
| ---------------------- | ----------------------------------------------- | ----------------------------------------------------------- |
| `inventory-downstream` | `/api/cron/inventory-downstream`, hourly at :10 | `ingestion_projector_checkpoint` row `inventory-downstream` |

## inventory-downstream

When `max(ingestion_run.publication_sequence)` is newer than the
`inventory-downstream` checkpoint and its `last_success_at` is at least
3 hours old (with 10 minutes of slack for cron jitter), the cron starts
`inventoryDownstreamWorkflow` with its check time. The workflow re-checks at
that same time and stamps it on success, so an hourly cron refreshes every
3 hours, not 4. It:

1. stores the homepage snapshot (`inventory-snapshot:<version>`) and
   revalidates the `daily-inventory` cache tag (`inventory-cache-refresh`),
   each only when behind;
2. requests the pages changed since the last IndexNow announcement, waits
   2 minutes for them to regenerate, and announces them
   (`indexnow-announcement`, production only);
3. advances its checkpoint.

A failed refresh, returned or thrown, is never retried within a tick. It
leaves the checkpoint behind, increments `failure_count`, sets
`last_error_tag` (`refresh_project`, `refresh_revalidate` or
`refresh_unexpected`) and blocks the consumer until `blocked_until`: 3 hours,
then 6, 12 and at most 24, with the same 10 minutes of slack. While blocked, each hourly tick reports
`backing_off` as a failed tick (heartbeat `/fail` and the Sentry issue), so a
stuck consumer stays red. The Sentry issue names the `blocked_until` time; clear it on the `inventory-downstream` row of `ingestion_projector_checkpoint` to retry sooner after fixing the cause. A success clears the backoff. The announcement is
best effort: IndexNow keeps its own checkpoint, so the next publication's
announcement includes anything that failed.

Together the gate and the backoff keep the snapshot, which reads every live
vehicle, to at most one read per 3 hours, whether refreshes succeed or fail.

## Pausing a consumer

Serve `false` for the Vercel boolean flag `consumer-<name>`
(`consumer-inventory-downstream`, `consumer-maintenance`,
`consumer-notification-delivery`). A paused consumer reads and writes nothing
and keeps its checkpoint, so it resumes where it stopped. A missing flag, an
evaluation error or a non-boolean value keeps the consumer enabled. A new
Vercel flag serves `false` in production, so creating one pauses its consumer.

Saved-search alerts are the exception: they also require the fail-closed
`search-alerts-enabled` flag (see `resume-search-alerts.md`).

## Heartbeats

Set `BETTERSTACK_CONSUMER_HEARTBEATS` to a JSON object of consumer name to
Better Stack heartbeat URL:

```json
{
  "inventory-downstream": "https://uptime.betterstack.com/api/v1/heartbeat/…"
}
```

Each tick reports its result as a value: a Sentry log for every tick, a Sentry
issue for a failed one, and (in production) a heartbeat ping. A failed tick
pings the heartbeat's `/fail` endpoint. A tick that found nothing to do, or a
paused consumer, counts as succeeded. Set each heartbeat's period to the
consumer's cron interval plus a grace period (hourly consumers: 1 hour period,
1 hour grace).

## Deploy hazard: old-deployment pass ends

Workflow runs stay pinned to the deployment that started them. A pass started
before this change still runs the old pass-end sequence (homepage snapshot,
revalidation, warmup and IndexNow) if it completes. Both paths are safe to run
in any order: every part keeps its own checkpoint keyed on
`publication_sequence` and only acts when behind it, so whichever runs second
finds the work done and records nothing new (see "repeats none of the work an
older deployment's pass end already did" in
`src/server/ingestion/inventory-downstream.test.ts`). The worst overlap is a
duplicate IndexNow submission if both announce the same window concurrently,
which IndexNow tolerates.
