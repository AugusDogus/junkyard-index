# Downstream consumers

Work that used to run only at the end of a completed ingestion pass now runs
as independent consumers. Each has its own cron, its own singleton workflow
hook (`downstream-consumer:<name>`), its own checkpoint and its own kill
switch. None waits for a pass to complete, and none calls a search backend
(`src/workflows/downstream-consumers-search.test.ts` checks each consumer's
import graph).

| Consumer                | Cron                                                | Checkpoint                                                          |
| ----------------------- | --------------------------------------------------- | ------------------------------------------------------------------- |
| `inventory-downstream`  | `/api/cron/inventory-downstream`, hourly at :10     | `ingestion_projector_checkpoint` row `inventory-downstream`         |
| `maintenance`           | `/api/cron/ingestion-maintenance`, daily 08:30 UTC  | none: each task deletes only what is eligible, so reruns are no-ops |
| `notification-delivery` | `/api/cron/notification-delivery`, every 15 minutes | each intent's own status, claim and `next_attempt_at`               |

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

## maintenance

`ingestionMaintenanceWorkflow` runs three tasks, each even if another fails,
and reports each result as a value (`deleted`, `complete`, or the failure):

- `prune-runs`: ingestion runs terminal for 90 days (see
  `ingestion-run-retention.md`);
- `stale-snapshots`: Blob snapshot chunks registered on runs no longer
  active, except URG's latest published census. This used to run at the
  start of every source run;
- `terminal-intents`: delivered or cancelled notification intents older than
  30 days. This used to run in every run's end-of-run cleanup.

Each task is bounded per run; `complete: false` means tomorrow's run continues.
A failed task fails the tick (Sentry issue, heartbeat `/fail`). The legacy
`vehicle_snapshot` and `vehicle_observation` drains that ran on every source
run were removed: both tables were empty in production in November 2026.

## notification-delivery

Every 15 minutes the cron starts `vehicleNotificationDeliveryWorkflow` when a
notification can go out now. Before this cron, delivery started only when a
day's pass or alert check finished, or hourly after the 18:00 UTC alert
deadline, so a retry or an expired claim could wait most of a day. Both
switches must allow it: `consumer-notification-delivery` (missing means
enabled) and the fail-closed `search-alerts-enabled`. Every delivery batch
rechecks both, so pausing either also stops a delivery started by the daily
alert check, the deadline cron or a workflow already running. Neither paused
state changes an intent. The workflow keeps its singleton hook token
(`vehicle-alert-delivery`), so a delivery started by an older deployment and
one started here never run at once.

`/api/status/alerts` is the alerts monitor. It returns 200 while
`search-alerts-enabled` pauses alerts (`status: "paused"`). Otherwise it
returns 503 when:

- the expected day's alert check has not completed. A check is expected only
  once it was opened and has had 2 hours from its own start, even across the
  07:00 UTC day boundary; today's is not expected before 20:00 UTC either.
  Days on which alerts were paused have no check, so switching alerts back on
  (after a pause of any length, even after 20:00 UTC) does not turn the
  monitor red. Blind spot: a day whose check the search-alerts cron never
  opens is not flagged here;
- a notification has been deliverable for more than 2 hours. Each intent is
  dated by its own release: the latest of its creation, retry time, expired
  claim, its owner finishing, today's hold lifting, its recipient's queued
  group or in-flight claim being cancelled or delivered, and the day start for
  a recipient who already got that day's digest.

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
