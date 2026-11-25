# Turso usage guard

The Turso Developer plan includes 2.5B rows read and 25M rows written per
billing month (the calendar month, UTC) across the whole organization,
development databases included. Usage past that is billed as overage. Rows
read count every row a statement steps through (a full scan of `vehicle`
reads every row, and a GROUP BY sorter about doubles it). Rows written count
every index entry too: setting an indexed column, even to its own value,
rewrites that index's entry.

## Where it runs

- `/api/cron/database-usage` runs hourly at :15 (`vercel.json`). It reads the
  organization's month-to-date usage and the production database's last 24
  hours from the Turso Platform API. It reads no database rows.
  - Every hour, a Sentry warning (`turso-usage`, fingerprint `spike`) when
    the production database used more than 150M rows read or 2M rows written
    in the last 24 hours (`TURSO_DAILY_SPIKE`): an operation may be running
    away.
  - At 07 UTC, a Sentry warning (fingerprint `pace`) when the month projects
    past 80% of either quota at its month-to-date pace, an error once usage
    passes the quota, and a warning when the guard is unconfigured or cannot
    read usage.
- `/api/status` includes the same check as `databaseUsage`, read at most once
  an hour. It never changes the status code or the `"stale":[]` keyword the
  Better Stack monitor matches.

The logic is in `src/server/turso-usage.ts`; the runtime wiring is in
`src/server/turso-usage-runtime.ts`.

## Configuration

Set both in the Vercel project's production environment:

- `TURSO_PLATFORM_API_TOKEN`: a Turso Platform API token with read access to
  the organization (a `read-only` token is enough).
- `TURSO_ORGANIZATION`: the organization slug. The production database name
  is read from the `TURSO_DATABASE_URL` host
  (`<database>-<organization>.<region>.turso.io`).

Until both are set, the check reports `unconfigured` and the 07 UTC run warns
once a day.

## When it fires

1. Open the Turso analytics for the day (top queries) and Sentry traces for
   the hours the usage jumped. The analytics list only the 10 slowest
   queries; hourly or 5-minute usage from the Platform API
   (`/v1/organizations/<org>/databases/<db>/usage?from=&to=`) shows when the
   rows were read.
2. Stop or narrow the operation. Don't turn the organization's `overages`
   setting off: that hard-caps the database and takes the site down.
