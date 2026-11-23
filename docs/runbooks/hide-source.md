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
   **Hide <name>**. To show it again, choose **Show on site**. **Change
   reason** updates the reason of a hidden source.
3. The change and who made it appear under **Recent actions**. No deploy is
   needed.

The `source_control` table holds the list (`visibility = 'hidden'` with a
`hidden_reason`), and `admin_action_log` records every change. Migration
`0030_source_control` created both and seeded Meeks as hidden, with the reason
above, so Meeks stayed hidden across the deploy that replaced the old code
constant.

## How long a change takes

| Surface                                                                                      | When a hide or show applies                                                                                                     |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Yard, region, chain, make and model pages, the homepage, the yard directory and the sitemaps | The next request. The toggle expires the cached list (`updateTag`) and every prebuilt page that read it.                        |
| Search filter options (yards, states, colors)                                                | The next request; a page that already loaded them may keep them until it reloads.                                               |
| A newly opened search page, and its server render                                            | At once: the page's search key is minted with the current list, and the server render filters with it.                          |
| A search page someone already has open                                                       | Within 15 minutes. Search keys now last 15 minutes and the page fetches the next one (with the new list) 10 minutes in.         |
| Source pickers and vehicle links on an open search page                                      | With that same key renewal.                                                                                                     |
| Saved-search alert scans                                                                     | The next scan batch: each batch reads the list from the database.                                                               |
| Alert emails and Discord messages being sent                                                 | Each send reads the list, so a vehicle of a hidden source links nowhere, even in alerts queued before the hide.                 |
| IndexNow announcements                                                                       | The next announcement, which reads the list from the database.                                                                  |
| Make totals on `/cars` (numbers only)                                                        | The next inventory snapshot, after the next publication of any source. Run `bun run inventory:project --force` to apply it now. |

Why two surfaces are not instant:

- **Open search pages.** A browser searches Algolia directly with a secured
  key that embeds `NOT source:"<source>"`. Algolia cannot revoke one secured
  key, so a key already handed out keeps working until it expires. Keys last
  15 minutes for this reason (minting them is local and costs no Algolia
  quota). A hand-made request with an old key can still read a just-hidden
  source until that key expires.
- **Make totals on `/cars`.** The totals are one number per make, stored by
  the inventory snapshot, with no per-source breakdown to subtract from. They
  never link to a source or show its vehicles. Rebuilding them reads every
  vehicle, so a toggle does not do it; the next publication does.

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
