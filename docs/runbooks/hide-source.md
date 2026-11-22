# Hiding a source from the public site

`HIDDEN_SOURCES` in
[`src/lib/hidden-source.ts`](../../src/lib/hidden-source.ts) lists sources the
public site must not show, each with its reason. Use it when sending visitors
to a source's website would harm them, for example when the site is hacked.
Meeks (`meeks`) is hidden because since 2026-11-22 every meeksrecycling.com
page redirects visitors to an unrelated site.

## What hiding does

From the deploy that lists a source, with nothing to flip:

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
- No vehicle or yard link points to its website, including vehicles already
  queued in alert emails and Discord messages.
- Make totals on `/cars` drop its vehicles at the next inventory snapshot,
  which follows the next publication of any source. Run
  `bun run inventory:project --force` to apply it at once.

## What hiding keeps

- Every row in Turso and every Algolia record. Nothing is deleted, so showing
  the source again restores everything.
- Ingestion. The source keeps running and still fails closed while its site
  is broken; its status endpoints still report it. Its accepted runs are how
  you can tell the site is back. To stop the attempts too, serve false for its
  `ingestion-source-<source>` Vercel flag
  ([`ingestion-source-flags.ts`](../../src/server/ingestion/ingestion-source-flags.ts)).
- Algolia settings. `source` is already in `attributesForFaceting`
  ([`algolia-settings-plan.ts`](../../src/server/ingestion/algolia-settings-plan.ts)),
  so the filter needs no settings change.

## Hide or show a source

1. Add the source and its reason to `HIDDEN_SOURCES`, or remove its entry.
2. When showing Meeks again, also remove the "hides Meeks" test in
   `src/lib/hidden-source.test.ts`. The other hidden-source tests run for
   whatever the list holds.
3. Merge. The change takes effect when the deploy goes live. Cached inventory
   pages change with it, because the hidden list is part of their cache keys.
4. After showing a source again, run `bun run inventory:project --force` or
   wait for the next publication to restore its vehicles in make totals.

## Why a code constant, not a Vercel flag

The list must be the same in the browser bundle, secured key minting, server
renders, alert scans and the keys of the daily inventory caches. A constant is
in all of them from the first request after deploy. The repo's Vercel flags
are read at request time on the server and fail open (a missing flag or a
failed evaluation keeps a source enabled), so a hide that must hold would need
a fail-closed flag read in each of those places and cache keys that follow it.
