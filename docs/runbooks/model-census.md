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

- A model's expected cards are its published count plus a sticky surplus: the
  placeholder or surplus rows its pages have listed above their count (for
  example Scotts' VIN-less NOF cards, or real rows on a badge that
  undercounts). The surplus carries across count changes and grows with any
  read that lists more. A surplus first seen, or grown, on a cold, gap or
  outage full read is unconfirmed: the next normal incremental run reads that
  page again (reason `short`) and confirms it at closing. That costs two GETs
  per such surplus model on connectors with a closing pass (the read and its
  closing re-read) and one on Calton. Only surpluses first seen or grown on
  that read are re-read; a full read that sees an already confirmed surplus
  keeps its confirmation. A fault on that read that leaves a page
  at exactly its badge has no signal and is an accepted cold-start limit.
- The same holds on any day a sale races a fault: the badge drops while the
  sold card is still listed, and a one-off fault hides one real card, so the
  page lists exactly its new badge. Nothing marks it short, closing does not
  re-read it, and it carries until its next read: a real card hidden for up to
  6 days in both modes (main: 1).
- A read that lists less than the surplus allows does not lower it: badge lag
  after a sale looks exactly like a lost card. The page counts as short and is
  read again every run, and evidence records when the window began and the
  count at which the surplus was last intact (`lowSince`, `lowCount`). A
  normal incremental run lowers the surplus once the window has lasted 6 run
  days (`MODEL_CENSUS_SWEEP_DAYS`), unless the count rose at some point in the
  window by at least the missing cards (`lowRise`): badges that count
  arrivals before their cards appear make the surplus look smaller for days,
  so a single arrival lagging a week does not lower it, and a later sale does
  not cancel that signal. Count changes never restart the window, and after 12
  run days the surplus is lowered whatever the count did, so a busy model
  cannot hold a removed placeholder open. Cold, gap and outage full reads
  never lower it.
- A surplus lowered by time while the page still lists less is kept as a
  `ceiling` for 12 run days (`ceilingSince`). Daily short reads stop, and the
  ceiling clears early once a read lists it again. While it stands, any read
  listing fewer than its count plus that ceiling is checked again:
  - **connectors with a closing pass:** closing re-reads the page, so a
    one-off fault behind a real placeholder fails the run;
  - **Calton (no closing pass):** the read sets `recheck` and the next run
    reads the page again (reason `short`), including after the read that
    lowered the surplus. The re-read settles it only when it lists the same
    cards (compared by card identity, not count); other cards, even at the
    same count, ask again. A one-off fault is published for at most one run.

  Both modes enforce the ceiling of the last accepted census (or the one a
  read raises), so they stop on the same run day: a ceiling set on run day L
  applies to reads through day L + 12, and the evidence drops it from day
  L + 12 on, carried or read. The Calton marker can therefore outlive its
  ceiling by one run.

- Costs, per surplus that really went away: about two GETs a day (the read
  and its closing re-read) for 6 run days, or up to 12 on a model whose badge
  keeps rising, then at most one extra GET on each read of that page during
  the 12-day ceiling. That is at most about 24 + 12 = 36 GETs once on a busy
  model read every day, and far fewer on a quiet one.
- Limits of the bounded ceiling: once a ceiling set on day L has lapsed, a
  returned placeholder is a first observation again. That happens when the
  page's first read after the placeholder returns is after day L + 12, or when
  continuous arrival lag hides a real placeholder for longer than the window
  plus the ceiling (about 24 run days). A one-off fault on that first read can
  hide a card until the page's next read (up to 6 days). The simulation in the
  pull request measures both.
- Counting only VIN-bearing cards instead would need per-source placeholder
  detection. Only Scotts' NOF rows are known to be VIN-less, and real surplus
  rows from badge undercounts (Calton, Central, Aviation) erode the same way, so
  the sticky surplus is the shared rule.
- Closing re-reads every page read this run whose cards differ from its count
  or fall below its closing floor (its expected cards, or count plus ceiling,
  `ModelCensus.closingFloors`), and fails the run if a re-read differs. Central
  lets a re-read of a page at or above its floor add cards (see its runbook);
  a short page must still repeat exactly. Calton has no closing pass, so its short pages are
  never confirmed and are re-read on the next run.
- A page below its count is stored as `confirmed` only when that closing
  re-read matched in a normal incremental run (an accepted census from the same
  day or the day before). Cold, gap and outage runs read every page and
  confirm nothing, so a fault confined to that one day cannot be carried past
  the next run. Any other page below its expected cards is read again on the
  next run.

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
  pages plus changes and triggers, and the closing pass. A surplus model whose
  page lists less than its sticky surplus adds about two GETs a day while its
  window lasts.
- **The day after a missed, failed or rejected run:** one full read, the same
  as that source's cold census. The run after that re-reads every short page
  the full read found (reason `short`) and re-confirms each at closing, about
  2N extra GETs for N short pages (OEM: about 103 short pages, so about 206).
  The same follows a cold run and an outage of 6 or more days.
