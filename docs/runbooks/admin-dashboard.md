# Admin dashboard

`/admin` is one private place to see how the site is running: the yard feeds
(sources), search updates, saved-search alerts, what the paid services'
free plans have left, and how people use the site. It never scans the
vehicle table and never searches Algolia, so opening it costs no Algolia
searches.

Each source's page also has controls: pause or resume its daily runs, hide it
from the public site or show it again, start a run now, and stop a run that
is stuck or holding others up.

## Who can open it

Only signed-in users whose Better Auth user id is in `ADMIN_USER_IDS`.
Everyone else, signed out included, gets the site's normal "page not found",
with the same title, and no admin data. (The page's code still links the
admin section's scripts, as Next.js does for any route, so someone reading
the HTML could tell the address exists; they see nothing from it.) Every
admin page and every control checks this on the server before doing
anything ([`require-admin.ts`](../../src/server/admin/require-admin.ts)).
While `ADMIN_USER_IDS` is unset or empty, no one can open it.

### Grant access

1. Sign in to the site with the account that should have access.
2. In the same browser, open `https://junkyardindex.com/api/auth/get-session`.
   It shows your session as JSON; your user id is `user.id`. (Or look it up
   in the Turso `user` table by email.)
3. In Vercel, open the project's Settings, Environment Variables, and set
   `ADMIN_USER_IDS` for Production to that id. For several people, separate
   ids with commas: `id1,id2`.
4. Redeploy production (Deployments, the latest production deployment,
   Redeploy). Environment variables apply to new deployments only.
5. Open `https://junkyardindex.com/admin`.

To remove someone, take their id out of the list and redeploy.

For local development, put `ADMIN_USER_IDS=<your dev user id>` in
`.env.local`; the dev database has its own user ids.

## What each page shows

All times show in your browser's time zone once the page has loaded, with
the zone named (for a moment before that, they show in UTC); hover one to
see it in UTC.
Where something failed, the page says so in plain words, and "Show full
error" opens the exact text the system stored.

### Overview (`/admin`)

- **Needs attention**: first, a run that has held the publish slot for over
  an hour (with how many runs wait behind it and for how long) and runs that
  run code from another deployment; each has a **Stop this run** button (see
  [Stop a run](#stop-a-run)). Then sources that failed their last 2 or more
  runs or have not been updated for over 36 hours (their cadence plus 12
  hours for a source crawled less often than daily; the same rule
  `/api/status` uses), a run that has made no progress for over 3 hours (it
  blocks that source's next run; left out when the run is already listed
  above with a stop), search falling behind, and late saved-search alerts.
  Each links to the page with details.
- **Sources**: how many are updated today, failing, out of date, running,
  paused (here or by their Vercel flag), hidden from the public site and
  retired, plus when the latest run started.
- **Search**: when search was last updated, how many vehicle changes are
  waiting to reach search, and whether search owes a full rebuild.
- **Saved-search alerts**: whether alerts are on, and the latest daily alert
  check.

### Sources (`/admin/sources`)

One row per source, problems first: its state, when its last run started and
finished, whether that run was accepted, rejected or is still running (with
why it was rejected), vehicles on the site now, the change from the previous
accepted run, failures in a row and when it was last accepted. Runs and
failures count the last 14 days.

A rejected run publishes nothing: the source's previous vehicles stay on the
site until a run is accepted. A run can also be rejected because it waited
over 24 hours for its turn to publish, or because its ingestion day ended
while it waited and the next day's crawl replaced it.

States, in the order the page checks them (a stuck run is listed first,
whatever its state):

| State                 | Meaning                                                                                 |
| --------------------- | --------------------------------------------------------------------------------------- |
| Retired               | No longer fetched (the yard's feed stopped reflecting its lot).                         |
| Paused                | Paused from its page here, or its `ingestion-source-<source>` Vercel flag serves false. |
| Running               | A run is in progress. "Stuck" marks one with no progress for 3 hours.                   |
| Failing               | Its latest finished run was rejected.                                                   |
| Out of date           | No run accepted for over 36 hours (cadence + 12 h if not daily), though none failed.    |
| Updated today         | A run was accepted since 07:00 UTC, when the ingestion day starts.                      |
| Resting, next crawl … | Fresh, and not due today by its cadence (U Pull R Parts: every third day).              |
| Not updated yet today | Its last run was fine, but none has been accepted today yet.                            |

"Hidden" and "Paused" badges show beside the name: a hidden source keeps
updating but stays off the public site (see [hide-source.md](hide-source.md)),
and hovering "Paused" says what paused it.

### One source (`/admin/sources/<source>`)

Its state and counts (from the last 14 days, as on the sources page), its
controls, the last 20 changes made to it here, and its last 14 runs: when
each started, how it ended, how long it took, pages and vehicles read, and
its full error text. While a run is active, Status also shows its stage,
whether it holds the publish slot (since when, and the runs queued behind
it), and whether it runs the current deployment's code; its row under
Recent runs has **Stop this run**.

#### Controls

Every change applies without a deploy, shows a result message in plain words
(with the raw error behind "Show details" if it failed) and is added to
**Recent actions**, which no one can edit or delete.

- **Daily runs: Pause runs / Resume runs.** A paused source is left out of
  the daily pass, and Run now refuses it. A run already in progress
  finishes. The source is paused if it is paused here **or** its
  `ingestion-source-<source>` Vercel flag serves false; the page shows both.
  The cron-secret `/api/admin/ingestion/run` route refuses a source paused
  here, but still runs one only its Vercel flag pauses, so you can test a
  fix before turning the flag back on.
  Resuming here does not turn the Vercel flag back on: change that in
  Vercel. `/api/status` lists paused sources instead of checking them; if
  it cannot read `source_control`, it answers 503 naming that read.
- **Public site: Hide from site / Show on site.** Hiding asks for a reason
  and a confirm step; showing asks to confirm too. Pages and new searches
  change at once, and open search pages within 15 minutes. See [hide-source.md](hide-source.md) for every surface.
- **Run now.** Asks to confirm, then starts one run of the source outside the
  daily pass, like the cron-secret route. It counts as one of today's
  attempts. It is refused, with the reason, when the source is retired,
  paused here or by its Vercel flag, or already has a run in progress (that
  run keeps going).

The controls are stored in the `source_control` table and the log in
`admin_action_log`.

#### Stop a run

Only one run publishes at a time (the publish slot, `commit_started_at` on
`ingestion_run`), and each source has one active run. A workflow run keeps
the code of the deployment it started on, so a fix deployed later never
reaches it. On Nov 23, 2026 a Hollander Stores run on a deployment with slow
reconciliation held the slot for over 12 hours while 17 runs waited, and
those sources could not start their next daily runs either.

Use **Stop this run** when a run has held the publish slot for over an hour
and is not finishing (check its last progress on its source page), when it
is stuck, or when it runs another deployment's code that a later fix
replaced. Runs on another deployment usually finish on their own; leave
those that are publishing promptly.

The dialog says what happens, and the stop works like the cron-secret
`POST /api/cron/vehicle-ingestion/abandon` route:

- The run is abandoned and its workflow cancelled. Runs queued behind it go
  ahead, and the source's slot is free.
- Vehicles it already published stay; its unpublished crawl data and any
  temporary search copy are discarded.
- The source's next scheduled retry comes 2 hours after the stop while it
  has attempts left today (3 a day), otherwise in tomorrow's daily pass.
  Today's retry is started by today's ingestion pass, which runs the code
  that pass started on: after a mid-day deploy, that can be the same old
  code the stopped run had. Tomorrow's pass runs current code.
- **Stop and run again** starts a fresh run on current code right away
  instead, like Run now (it is refused, with the reason, if the source is
  paused or retired; the stop still happens). For a run on another
  deployment it is the dialog's primary button.
- A run past its crawl (any stage but `sources`) may have written part of
  its data, so stopping it makes the next run rebuild search in full. The
  dialog asks you to confirm that first. If the run moved past its crawl
  after the page loaded, the stop is refused; reload and confirm.
- A run with an unconfirmed Algolia index move (`full_reindex_move_pending`)
  cannot be stopped; the dialog says so. Wait for the move to be confirmed.
- If its workflow could not be cancelled, the result names it: cancel it in
  the Vercel dashboard. The run is stopped in the database either way.

Each stop of a source's run is logged under that source's Recent actions as
"Stopped a run" with the run id, stage, workflow and whether a full rebuild
follows. A stop of an every-source run is logged in `admin_action_log` with
source `all`, but no page shows it. A run that ended after the page loaded
is reported as already ended, and nothing is stopped or logged. Whether a run runs the
current deployment's code comes from the workflow backend's list of live
ingestion workflows; it shows as unknown off Vercel, when the list cannot be
read or does not answer within 5 seconds, or for a workflow it does not list
(one that ended, or started over two days ago). Only the overview and a
source page with an active run read that list.

### Search & alerts (`/admin/search`)

- **Search updates**: who updates search (each run inline, or the separate
  search updater), whether that updater is paused, when search was last
  updated, changes waiting, whether a full rebuild is owed and, for the
  separate updater, its circuit breaker and live index. This is the same
  check `/api/status/search` runs.
- **Recent search updates**: the last 20 runs that updated search.
  "Rejected, previous vehicles kept" means that source's run failed and
  search kept its vehicles from before.
- **Saved-search alerts**: whether the `search-alerts-enabled` flag has alerts
  on, whether they are on schedule (the same check as `/api/status/alerts`),
  and each daily alert check in the last 14 days with emails and Discord
  messages sent, waiting, failed and retrying, or cancelled.

### Budgets (`/admin/budgets`)

Read from Hyperbrowser and Algolia, at most once every 10 minutes for all
admins together; the page says when the figures were checked.

- **Hyperbrowser credits**: used, remaining and the plan's limit (the free
  plan has 5,000; whether they renew each month is not confirmed), credits
  used per UTC day for 14 days, the average over the last 7 full days, the
  credits used by month end at that pace, and the day the remaining credits
  run out at that pace. A red notice shows when that day comes before the
  month ends, and another when no credits remain. Hyperbrowser sessions do
  not record which yard opened them, so the daily figures are totals for
  all yards (the Hyperbrowser yards are listed in
  [hyperbrowser-sessions.md](hyperbrowser-sessions.md)). The page reads up
  to 30 pages of 100 sessions, newest first; if that does not reach 14 days
  back, it says which days are short and leaves them out of the average.
  If Hyperbrowser ever lists sessions out of order, the read stops, the page
  says so and shows no forecast.
- **Algolia**: records stored, against the free plan's 1,000,000. Search
  requests used this period show as "Not readable": Algolia's Usage API
  refused the site's write key because it lacks the "usage" permission
  (checked Nov 22, 2026). Algolia may also keep the Usage API for paid
  plans; that was not tested. Check Usage in the Algolia dashboard, and see
  [search-quota.md](search-quota.md) for the alarms. Records are read with
  the write key, so only production shows them; other deployments say
  "Production only".

### Analytics (`/admin/analytics`)

Days are UTC. Database figures are read fresh on each visit; they touch the
user, saved search and alert tables only. The alert reads pick delivered or
cancelled alerts by status and then filter by date. That stays small
because ingestion maintenance deletes delivered and cancelled alerts after
30 days. If that purge stops or is lengthened, add an index on
`search_notification_intent(status, delivered_at)`.

- **Users**: total, verified emails, and sign-ups per day for 30 days.
- **Paid plans**: from Polar, which holds every subscription (the database
  keeps none), at most every 10 minutes. Paying accounts (customers with an
  active subscription), active subscriptions per plan, how many are set to
  cancel at the end of their paid period, and plans started, cancelled or
  ended in the last 30 days (newest 20). A plan that ended in the window
  but was cancelled before it may be missing. No names or emails are shown.
- **Saved searches**: total, how many have email or Discord alerts on, and
  new ones per week (weeks start Monday) for 12 weeks.
- **Alerts sent**: emails and Discord messages delivered per day for 30
  days (one email digest can cover several saved searches, so emails are
  counted by delivery group; Discord sends one message per saved search),
  saved-search alerts that failed and are waiting to retry, and those
  cancelled in the last 30 days.
- **Top searches**: the 20 most searched queries over the last 7 days, from
  Algolia Analytics, with every sort order added together. Reading Analytics
  is not a search, so it costs none of the plan's searches. The free plan
  keeps 7 days of Analytics. Algolia counts a search once typing settles,
  so these counts are lower than the search requests billed. Production
  only, as for records.

## Reads of other services

[`admin-cached-reads.ts`](../../src/server/admin/admin-cached-reads.ts)
holds every read of Hyperbrowser, Algolia and Polar. Each is cached for 10
minutes in the Next.js data cache under a key starting with `admin`, and
only admin pages call them, after `requireAdmin`. The key names its
10-minute window, so the first visit in a new window waits for a fresh read
instead of being shown an old entry while it refreshes in the background;
nothing shown is more than 10 minutes old. A failed read is not
cached, so reloading tries again. Bump a read's version (`-v1`) when its
result shape changes, since cached entries outlive deployments.

## Rolling back past the controls

Builds from before the controls ignore `source_control`, so a rollback shows
every source hidden here and runs every source paused here. Prefer rolling
forward. Otherwise, first re-hide each hidden source with the old
`HIDDEN_SOURCES` constant in the build you roll back to, and serve false for
each paused source's `ingestion-source-<source>` Vercel flag. The steps, and
how the `v3` and `v4` inventory snapshots behave across the rollback, are in
[hide-source.md](hide-source.md#rolling-back-past-this-change).
