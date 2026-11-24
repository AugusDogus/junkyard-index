# Hiding a source from the public site

Hide a source when sending visitors to its website would harm them, for
example when the site is hacked. Meeks (`meeks`) is hidden because since
2026-11-22 every meeksrecycling.com page redirects visitors to an unrelated
site.

## Hide or show a source

1. Open `/admin/sources/<source>` (signed in as an admin; see
   [admin-dashboard.md](admin-dashboard.md)).
2. Under **Controls**, **Public site**, choose **Hide from site**, write why
   (required, up to 500 characters; only admins see it) and confirm with
   **Hide <name>**. To show it again, choose **Show on site** and confirm with
   **Show <name>**. **Change
   reason** updates the reason of a hidden source.
3. The change and who made it appear under **Recent actions**. No deploy is
   needed.

The `source_control` table holds the list (`visibility = 'hidden'` with a
`hidden_reason`), and `admin_action_log` records every change. Migration
`0030_source_control` created both and seeded Meeks as hidden, with the reason
above, so Meeks stayed hidden across the deploy that replaced the old code
constant.

## Automatic hide for stale sources

A source with no accepted publication for 36 hours
(`INVENTORY_STALE_AFTER_HOURS`) stays listed, but every listing of its
vehicles (search hits, yard, region, chain, make and model pages) says
"Last checked N days ago", using the yard's own `last_published_at` when the
yard has one (so a preserved yard shows its own age) and the source's
otherwise. After 7 days (`INVENTORY_HIDDEN_AFTER_DAYS`) the source is hidden
like an owner hide, through the same list, search keys and Algolia filter.

Nothing is stored for the automatic hide: `loadHiddenSources`
(`src/server/source-control/hidden-sources.ts`) adds every active source
without an accepted publication in that window to the owner's list each time
it is read. The source's next accepted publication shows it again, once the
cached list is read again: the cached list carries the `daily-inventory` tag,
which the inventory-downstream consumer expires after each publication. On
`/admin/sources` it shows as **Hidden (stale)**, and its page names the last
accepted publication. The owner's Show button cannot override it; fix the
source's crawl instead. A database with no recent runs (such as a fresh
development database) hides every active source.

The automatic hide is per source. A preserved yard (one a run kept from an
earlier publication) shows its age but is not hidden on its own: Algolia
records have no filterable yard key that is unique across sources.

## How long a change takes

| Surface                                                                                                              | When a hide or show applies                                                                                                                          |
| -------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Yard, region, chain, make and model pages, make totals on `/cars`, the homepage, the yard directory and the sitemaps | The next request. The toggle expires the cached list (`updateTag`) and every prebuilt page that read it.                                             |
| Search filter options (makes, yards, states, colors)                                                                 | The next request; a page that already loaded them may keep them until it reloads.                                                                    |
| A newly opened search page, and its server render                                                                    | At once: the page's search key is minted with the current list, and the server render filters with it.                                               |
| A search page someone already has open                                                                               | Within 15 minutes of its next search. Keys last 15 minutes, and the page fetches a new one (with the new list) on its first search after 10 minutes. |
| Source pickers and vehicle links on an open search page                                                              | With that same key renewal.                                                                                                                          |
| Saved-search alert scans                                                                                             | The next scan batch: each batch reads the list from the database.                                                                                    |
| Alert emails and Discord messages being sent                                                                         | Each send reads the list, so a vehicle of a hidden source links nowhere, even in alerts queued before the hide.                                      |
| IndexNow announcements                                                                                               | The next announcement, which reads the list from the database.                                                                                       |

Why open search pages are not instant: a browser searches Algolia directly with a secured
key that embeds `NOT source:"<source>"`. Algolia cannot revoke one secured
key, so a key already handed out keeps working until it expires. Keys last
15 minutes for this reason (minting them is local and costs no Algolia
quota). A hand-made request with an old key can still read a just-hidden
source until that key expires.

Make and model pages and make totals read the inventory snapshot, which
stores every source (hidden ones too) with per-source counts. Pages leave the
hidden list out when they read it, so a toggle needs no new snapshot and reads
no vehicles.

The search filter options are cached by hidden list. The first request after
a toggle to a list not seen that day reads the states and colors of every
live vehicle once, as the daily refresh does.

After expiring the cached list, the toggle reads it once, so the first public
request finds the new list cached instead of reading the database. If that
read fails, the change is still saved and the next request reads the list.

If the cached list's expiry were ever lost, the cache falls back to a daily
lifetime, the same as the pages that read it.

## What hiding does

- Search (browser and server renders), search counts and facet searches add
  `NOT source:"<source>"` to every Algolia request. Secured browser keys embed
  the same filter, which Algolia ANDs with each request's own filters.
- Saved-search alerts never match its vehicles.
- Its yards leave the homepage map and lists, the yard directory, region,
  chain and yard pages (which return 404), nearby-yard lists, sitemaps and
  IndexNow announcements. Its yards, states and colors leave the search
  filter options, and the source pickers no longer offer it.
- Its vehicles leave the homepage arrivals, make and model pages, model
  arrivals and yard-make sitemap entries.
- No vehicle links to its website, including vehicles already queued in alert
  emails and Discord messages. Its yards link nowhere because no page lists
  them.
- Cached inventory loaders include the hidden list in their cache keys, so a
  hide or show reads a fresh entry rather than one built with the old list.

## What hiding keeps

- Every row in Turso and every Algolia record. Nothing is deleted, so showing
  the source again restores everything.
- Ingestion. The source keeps running and still fails closed while its site
  is broken; its status endpoints still report it. Its accepted runs are how
  you can tell the site is back. To stop the attempts too, use **Pause runs**
  on the same page (or serve false for its `ingestion-source-<source>` Vercel
  flag).
- Algolia settings. `source` is already in `attributesForFaceting`
  ([`algolia-settings-plan.ts`](../../src/server/ingestion/algolia-settings-plan.ts)),
  so the filter needs no settings change.

## Where the code is

- [`src/lib/hidden-source.ts`](../../src/lib/hidden-source.ts): the
  `HiddenSources` value and its filters. Every function takes the list it
  applies, so nothing falls back to an old copy.
- [`src/server/source-control/`](../../src/server/source-control/): the
  table's reads and writes, the cached server read (`getHiddenSources`,
  tagged `source-control`) and the admin action.
- The browser gets the list with its search key (`SearchKeyGrant.hiddenSources`)
  and passes it down through `HiddenSourcesProvider`.

## Rolling back past this change

Builds from before the admin controls ignore `source_control`: they hide
only the sources in the old `HIDDEN_SOURCES` constant in
`src/lib/hidden-source.ts` (Meeks) and pause only by Vercel flag. A rollback
would show every source hidden from `/admin` and run every source paused
there. Prefer rolling forward with a fix. If you must roll back:

1. List what `/admin` controls:

   ```sql
   select source, ingestion, visibility, hidden_reason from source_control
   where ingestion = 'paused' or visibility = 'hidden';
   ```

2. Add each hidden source to `HIDDEN_SOURCES` in the build you roll back to,
   with its reason, and deploy that build.
3. Serve false for each paused source's `ingestion-source-<source>` Vercel
   flag.

The table and its rows stay; migrations do not run backwards, and a later
roll forward reads them again.

Make and model pages read the inventory snapshot by version. This change
stores `v4` (every source, filtered when read); older builds read `v3`
(hidden sources left out when stored). Each build writes only its own
version, and a deploy computes it only when it is missing. After a rollback,
`v3` shows counts from before this change shipped until the next accepted
ingestion run recomputes it, and a roll forward likewise shows the `v4` of
the last run before the rollback. To refresh at once, run
`bun run inventory:project --force` with that database's credentials.
