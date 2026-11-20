# Incremental model census (URG parts connectors)

`src/server/ingestion/model-census.ts` is shared by the A Plus, Aviation, Chaz,
Central, Northwest, Calton, Denton, OEM, Jim's Import and Scotts connectors.
Each connector's runbook gives its own counts and floors; this page states the
shared rules.

## What a run reads

- Every run reads the fixed opening pages and every make menu.
- **Incremental day:** when the last accepted census is from the same day or
  the day before, a model page is read only when one of these holds:
  - the model is new;
  - its published count changed;
  - a connector trigger names it, such as an unseen arrival;
  - it is `short` (below its expected cards and not confirmed, see below);
  - it is `stale` (read 6 or more run days ago);
  - it is in today's sweep slice.

  Every other model carries its last accepted page at no request cost. A
  model's sweep slice comes from a hash of its key, so every model is re-read
  within 6 days.

- **After a gap:** when the last accepted census is more than one day old
  (a missed, failed or rejected run), every model page is read (reason `gap`).
  A fault that caused a rejection is therefore re-read in full and cannot hide
  behind carried pages. The next accepted run returns to incremental reading.
- **Cold:** with no usable census (first run, contract change, unreadable
  cursor), every page is read.
- The census is seeded from the terminal cursor of the source's newest
  accepted publication (`SourcePublication.latestAcceptedCursor`: inventory
  committed, whether or not search published it). Rejected, failed and
  unpublished runs never seed it.

## Short pages and closing

- A model's expected cards are its published count plus any surplus its last
  accepted page listed above that page's own count (placeholder or surplus
  rows). The surplus carries across count changes.
- Closing re-reads every page read this run whose cards differ from its count
  or fall below its expected cards (`ModelCensus.closingReads`), and fails the
  run if a re-read differs. Calton has no closing pass, so its short pages are
  never confirmed and are re-read on the next run.
- A page below its count is stored as `confirmed` only when that closing
  re-read matched and the run was judged by the replay floor (see below). Any
  other page below its expected cards is read again on the next run.

## Coverage floors (checked before anything is published)

1. **Badge floor:** read plus carried cards against today's model counts, each
   model capped at its own count, at a per-source minimum. It also applies to
   cold runs.
2. **Replay floor (97%, every source):** read plus carried cards against the
   last accepted card count of every model, while the last accepted run is
   under 6 days old. A model whose count dropped has its reference lowered by
   that drop; an increase demands nothing, because pages can lag new arrivals.
   Healthy runs sit near 100% even where badges overcount, so a sweep slice
   emptied or cut to one card per page fails the first broken run.

After a rejection, every later run is a full read judged against the same last
accepted census, so a broken slice stays rejected. Once the last accepted run
is 6 or more days old (an outage, or a real inventory drop that stayed rejected
that long), the run is judged on the badge floor alone and confirms no short
page. A real drop therefore blocks publication for at most 5 days, then clears
on its own.

## Request cost

- **Steady state:** opening pages, every make menu, about a sixth of the model
  pages plus changes and triggers, and the closing pass.
- **The day after a missed, failed or rejected run:** one full read, the same
  as that source's cold census.
- **After an outage of 6 or more days:** one full read, then the next run
  re-reads that read's short pages (reason `short`) once, because the outage
  run confirms none.
