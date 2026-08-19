# Search index migrations

VIN pattern search uses an additive Algolia schema migration. The application
and its durable workflows ship together in the Vercel deployment.

## One-time setup

Add `CRON_SECRET` to the Vercel project for the production environment. Use a
random value with at least 16 characters. Vercel sends it as a bearer token when
it invokes configured cron routes.

The production Vercel environment must also contain the Turso, Algolia, and
other server variables used by ingestion and alert delivery.

## Trigger.dev cutover

Complete this cutover before merging the Vercel Workflow deployment:

1. In the Trigger.dev production dashboard, pause the schedule for
   `vehicle-ingestion-daily`.
2. Confirm the schedule is inactive and no Trigger.dev ingestion run is active.
3. Merge and deploy the Vercel Workflow version.
4. Confirm only Vercel owns the 07:00 UTC ingestion schedule.

Removing the Trigger.dev task from this repository does not deactivate its
already deployed schedule. Never leave both schedulers enabled. The database
run lock prevents most duplicate writes, but the retired task can still project
to Algolia or deliver alerts after losing the lock.

## Normal deployment

1. Merge the PR to `main`.
2. Vercel deploys the application and Workflow SDK entry points together.
3. Vercel Cron starts `searchIndexMigrationWorkflow` at 06:00 UTC each day. The
   migration exits immediately after schema version `3` is ready.
4. The migration configures Algolia, backfills one durable vehicle batch per
   Workflow step, validates exact VIN filters, then writes search schema version
   `3` to the index settings. A retried batch safely rewrites the same object IDs
   before advancing its VIN cursor.
5. The production UI polls readiness. VIN search stays inactive until version
   `3` is confirmed, then enables automatically.

The daily ingestion workflow starts at 07:00 UTC. Workflow hook tokens prevent
duplicate active runs and serialize the migration with the ingestion projector,
so only one workflow writes to Algolia at a time. PR preview deployments do not
run Vercel Cron jobs.

Each provider runs as resumable, bounded chunks. A chunk writes vehicles to the
run-scoped `vehicle_snapshot` table and advances its source cursor in the same
transaction. Reconciliation starts only after every source reaches a terminal
state, then snapshots are removed after the system-of-record update commits.
Failed runs remove their snapshots while recording failure. A later run also
removes terminal snapshots and snapshots from abandoned runs older than seven
days.

## Observe and verify

1. Open the production project in Vercel and select the Workflows tab.
2. Confirm `searchIndexMigrationWorkflow` completed. Its steps report batch and
   record progress.
3. Enter a complete VIN in the production search bar and confirm it is detected
   as an exact VIN.
4. Search a known exact VIN, then test a pattern such as
   `YV4C*85**********`.
5. Starting from a known matching VIN, replace one position with a character
   set containing its original character, then with a range containing its
   original character. Confirm both patterns return the vehicle.
6. Confirm ordinary text search and each sort still return results.

For local inspection, use `bun run workflow:inspect` or
`bun run workflow:web` while the development server is running.

## Failure and retry

If deployment or migration fails, production search continues without the VIN
filter. VIN search remains inactive.

Workflow steps retry transient failures twice with exponential backoff, for
three total attempts. Validation failures are fatal because retrying cannot fix
invalid indexed data. To start another run immediately, invoke the protected
production route:

```bash
curl --fail \
  --header "Authorization: Bearer $CRON_SECRET" \
  https://YOUR_PRODUCTION_DOMAIN/api/cron/search-index-migration
```

Starting the route more than once is safe. A second active run deduplicates to
the first, and a completed migration exits after reading schema version `3`.

Do not run `scripts/sync-algolia.ts` as the deployment path. It remains a manual
recovery tool.

## Rollback

Roll back the Vercel deployment normally. Running workflows remain pinned to the
deployment version that started them. The added Algolia record attribute, facet,
and version marker are backward compatible, so no destructive index rollback is
needed. Do not delete or replace the production index during rollback. Do not
reactivate the Trigger.dev schedule until the Vercel cron is inactive and any
Vercel ingestion run has completed or failed.
