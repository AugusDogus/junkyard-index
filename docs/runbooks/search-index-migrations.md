# Search index migrations

VIN pattern search uses an additive Algolia schema migration. The application,
Trigger.dev task, and migration ship from one merge to `main`.

## One-time setup

Add these GitHub Actions repository secrets:

- `TRIGGER_ACCESS_TOKEN`: a Trigger.dev personal access token used to deploy tasks.
- `TRIGGER_SECRET_KEY`: the production Trigger.dev project key used to start the
  deployed migration task.

The Trigger.dev production environment must already contain the Turso and Algolia
environment variables used by the existing ingestion tasks.

## Normal deployment

1. Merge the PR to `main`.
2. Vercel deploys the application from `main`.
3. The `Deploy Trigger.dev` GitHub Actions workflow deploys the production tasks,
   then starts `search-index-schema-v2`.
4. The migration configures Algolia, backfills every vehicle in batches, validates
   exact VIN filters, then writes search schema version `2` to the index settings.
5. The production UI polls readiness. The VIN input stays disabled until version
   `2` is confirmed, then enables automatically.

PR preview deployments never run the production migration because the workflow
only runs after a push to `main`.

## Observe and verify

1. Confirm the GitHub Actions workflow deployed the Trigger.dev tasks and started
   a migration run.
2. Watch `search-index-schema-v2` in the Trigger.dev production dashboard. Progress
   logs include batches and records processed.
3. Open production search filters. Confirm the VIN input changes from `Preparing`
   to enabled.
4. Search a known exact VIN, then test a pattern such as `YV4C*85**********`.
5. Confirm ordinary text search and each sort still return results.

## Failure and retry

If deployment or migration fails, production search continues without the VIN
filter. The VIN input remains disabled.

Rerun the failed GitHub Actions job. The migration is idempotent. It can safely
repeat settings and record writes, and it exits immediately after schema version
`2` is present.

Do not run `scripts/sync-algolia.ts` as the deployment path. It remains a manual
recovery tool.

## Rollback

Roll back the Vercel deployment normally. The added Algolia record attribute,
facet, and version marker are backward compatible, so no destructive index rollback
is needed. Do not delete or replace the production index during rollback.
