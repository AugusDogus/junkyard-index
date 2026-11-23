# Admin dashboard

`/admin` is one private place to see how the site is running: the yard feeds
(sources), search updates, saved-search alerts, what the paid services'
free plans have left, and how people use the site. It never scans the
vehicle table and never searches Algolia, so opening it costs no Algolia
searches.

It only shows things. Controls (run a source now, pause it, hide it from the
site) come in a later update.

## Who can open it

Only signed-in users whose Better Auth user id is in `ADMIN_USER_IDS`.
Everyone else, signed out included, gets the site's normal "page not found",
with the same title, and no admin data. (The page's code still links the
admin section's scripts, as Next.js does for any route, so someone reading
the HTML could tell the address exists; they see nothing from it.) Every
admin page checks this on the server
([`require-admin.ts`](../../src/server/admin/require-admin.ts)).
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

- **Needs attention**: sources that failed their last 2 or more runs or have
  not been updated for over 36 hours (the same rule `/api/status` uses), a
  run that has made no progress for over 3 hours (it blocks that source's
  next run), search falling behind, and late saved-search alerts. Each links
  to the page with details.
- **Sources**: how many are updated today, failing, out of date, running,
  paused (by their Vercel flag), hidden from the public site and retired,
  plus when the latest run started.
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
over 24 hours for its turn to publish.

States, in the order the page checks them (a stuck run is listed first,
whatever its state):

| State                 | Meaning                                                                    |
| --------------------- | -------------------------------------------------------------------------- |
| Retired               | No longer fetched (the yard's feed stopped reflecting its lot).            |
| Paused                | Its `ingestion-source-<source>` Vercel flag serves false.                  |
| Running               | A run is in progress. "Stuck" marks one with no progress for 3 hours.      |
| Failing               | Its latest finished run was rejected.                                      |
| Out of date           | No run accepted for over 36 hours, though none failed (none may have run). |
| Updated today         | A run was accepted since 07:00 UTC, when the ingestion day starts.         |
| Not updated yet today | Its last run was fine, but none has been accepted today yet.               |

"Hidden" is shown beside the state: a hidden source keeps updating but stays
off the public site (see [hide-source.md](hide-source.md)).

### One source (`/admin/sources/<source>`)

Its state and counts (from the last 14 days, as on the sources page), its
flags (the daily-run Vercel flag and whether it is hidden, with the reason),
and its last 14 runs: when each started, how it ended, how long it took,
pages and vehicles read, and its full error text.

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
  month ends. Hyperbrowser sessions do not record which yard opened them, so
  the daily figures are totals for all yards (the Hyperbrowser yards are
  listed in [hyperbrowser-sessions.md](hyperbrowser-sessions.md)). The page
  reads up to 30 pages of 100 sessions; if that does not reach 14 days back,
  it says which days are short.
- **Algolia**: records stored, against the free plan's 1,000,000. Search
  requests used this period show as "Not available on this plan": Algolia's
  Usage API needs a key with the "usage" permission and a Premium plan
  (checked Nov 22, 2026: the write key is refused). Check Usage in the
  Algolia dashboard, and see [search-quota.md](search-quota.md) for the
  alarms. Records are read with the write key, so only production shows
  them; other deployments say "Production only".

### Analytics (`/admin/analytics`)

Days are UTC. Database figures are read fresh on each visit; they touch the
user, saved search and alert tables only.

- **Users**: total, verified emails, and sign-ups per day for 30 days.
- **Paid plans**: from Polar, which holds every subscription (the database
  keeps none), at most every 10 minutes. Paying accounts (customers with an
  active subscription), active subscriptions per plan, how many are set to
  cancel at the end of their paid period, and plans started, cancelled or
  ended in the last 30 days (newest 20). No names or emails are shown.
- **Saved searches**: total, how many have email or Discord alerts on, and
  new ones per week (weeks start Monday) for 12 weeks.
- **Alerts sent**: emails and Discord messages delivered per day for 30
  days, sends that failed and are waiting to retry, and those cancelled in
  the last 30 days.
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
only admin pages call them, after `requireAdmin`. A failed read is not
cached, so reloading tries again. Bump a read's version (`-v1`) when its
result shape changes, since cached entries outlive deployments.
