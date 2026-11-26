# Chaz's Used Auto Parts & Towing

See the current [source flags and census floors](provider-coverage-go-live.md).

Local source `chaz`, yard `taneytown`, supplier `MD08`. Qualification
and application verification use saved public captures. No production flags,
inventory, database, Algolia, deploys, pushes or pull requests were changed.

## Published scope

The finite known source is every literal make/model route published under
`https://www.chazsauto.com/parts/makes/`, unioned with the native
`/recent-arrivals/` cards. Native copy includes vehicles awaiting part-out.
The recent feed alone is partial. Neither the published graph nor its badge
sums establish an unseen backend census or an atomic inventory snapshot.

The November 12, 2026 model capture contains 36 makes, 248 models and 1,106
native donor cards. Nine model pages explicitly report no results. Captures
include 35 newly read make pages, 247 newly read model pages, the saved
Mitsubishi make and Mirage model, the saved make directory, contact and 60-card
recent surface. No native pagination or network continuation was found. The
visible model filters only hide cards already present in the returned DOM.

The strict union has 1,166 observations: 1,063 accepted unique donors, 54 benign
duplicate observations and 49 rejected observations. Rejections comprise 43
missing or invalid VIN observations and six occurrences of three conflicting
VINs. Required rejection is 4.20%; benign duplication is 4.63%. All occurrences
of the three `NISSAN/DATSUN` versus `NISSAN` conflicts are rejected. Their valid
VINs remain independent presence evidence. No alias or preferred winner is
introduced. Three accepted VINs occur only in the recent surface.

Model labels and routes retain native display variants and punctuation.
Descriptive YMM comes from labelled native fields, never a VIN decoder or
decoded URL tokens. A repeated brand in an inquiry label is accepted only as
literal repetition or the published make/model control composite. A genuine
same-card inquiry contradiction stops the source before callbacks. Badge
differences remain diagnostics and never filter rows or supply the quality
denominator.

## Yard provenance

Native contact publishes 6035 Taneytown Pike, Taneytown, MD 21787,
410-876-7815 and toll-free 888-212-8775. No email is supplied. Website:
`https://www.chazsauto.com/`.

The point 39.6747856, -77.2116775 is the matching named-business ASYD/Google
place point, with accuracy unstated. The alternative ARA point
39.6644591, -77.1840029 remains in qualification evidence. The native iframe's
longitude is a viewport center and is not used as a yard point. The native
named-business map corroborates ownership and location. Comparison with 255
accepted yards found no name, address, phone, domain or 500-meter overlap.
The nearest accepted yard was Mount Airy, about 35.5 km away.

## Runtime contract

The connector reads official contact, recent arrivals, the make directory and
every literal make link. Model pages go through the shared
[model census](model-census.md) with `reuse: "never"`: every run reads every
published model page, so the union always covers every published model as the
site lists it today. Badge-only reuse was removed because a donor crushed and
another placed under the same model keeps the badge, so a carried page would
keep publishing the crushed donor and miss the new one. The census still labels
each read: the day after an accepted run, a model is read as new, count (its
badge changed), trigger, short, or otherwise daily. Chaz's trigger is a recent
arrival entered no earlier than the day before the last accepted run that binds
to the model by destination but is missing from its last accepted page. After a
missed, failed or rejected run, every model page is read as gap. Only owned HTTPS browse
URLs are allowed. It never requests donor details, images, hidden routes,
part searches or an inferred model route. Supplier declarations must all agree
on `MD08`. Complete document, native owner, address and phone checks apply.
Redirects, partial content, non-HTML responses, request failures and any other
non-200 status stop the run without automatic retry. An origin HTTP 502, 503 or
504 instead defers the chunk (`ProviderNotReadyDeferred`): the LiteSpeed origin
answers these on single pages for minutes while neighbouring pages still answer
200 (2026-11-26 failed all three daily runs this way). A chunk that already
validated GETs returns that checkpoint paused; a chunk with no progress defers,
and the run retries the same page after the five-minute deferral delay for up
to three hours without progress.

Closing controls repeat contact, the make directory and every model page read
this run whose cards differ from its badge or fall below its expected count
(`ModelCensus.closingReads`: the badge plus a sticky surplus of placeholder or
surplus rows, lowered only after six run days of lower reads, or twelve when the
badge rose by at least the missing cards during that window, which looks like
arrival lag; a surplus lowered by time while the page still lists less stays as a ceiling, so closing still re-reads any read below it, see [Incremental model census](model-census.md)). A
changed fingerprint stops the run before emission, so a transient short or
empty page is never published. A page below its badge that re-reads
identically, such as the dead `&` routes (TOWN & COUNTRY: badge 8, explicit
empty), is confirmed only by a normal incremental run (not a cold, gap or outage
full read). It is still read on every run; closing skips it while it repeats
its confirmed evidence and re-reads it once it changes. A page that only lost surplus cards without its badge
dropping is never confirmed and is read again on the next run as short. Other
model-level changes surface as badge changes in the next run's opening menus.

Before the snapshot, the union of model cards read this run, each model capped
at its badge, must cover at least 92% of today's model badges
(`CHAZ_MINIMUM_BADGE_COVERAGE`). The saved Nov 12 capture covers 94.2%
(1,106 of 1,174; 68 unexplained badge overcounts on 46 models) and the Nov 18
opening 99.3% (one dead `&` route short). Emptying any one sixth of the models
(a census slice, `ModelCensus.slice`) drops either capture to at most 90.9%,
so a fault that empties that many pages fails the first broken run with
nothing published.

Cutting a slice to one card per page is subtler. Nov 18's lightest slice
(slice 5: 30 models, 102 badge cards) cut that way still covers 93.5% of
badges (1,043 of 1,116), above the badge floor. The shared replay floor
(`MODEL_CENSUS_REPLAY_MINIMUM`, 97%) also compares the union with the last
accepted card counts of every model with a last accepted page, each lowered by
any drop in its badge. That cut lists only 94.1% of them (1,043 of 1,108), so
it fails. A full read after a gap is judged the same way while the last
accepted run is under six days old; after that, only the badge floor applies. Cut to one card per page, every
slice of either capture lists 78.9% to 94.1% of its last accepted cards (the
Nov 12 slice 5 also 94.1%). Healthy incremental runs sit near 100%.

Chaz specifics against the [shared census rules](model-census.md): the badge
floor is 92% because the Nov 12 capture's 68 unexplained badge overcounts hold
healthy runs at 94.2%, while emptying any slice falls to 90.9% or less.
Closing confirms short pages. On the Nov 18 graph (35 makes, 240 models) every
run is a full read and costs 280 GETs: 278 opening reads, then contact and the
make directory at closing. A cold or gap run, and the day after one, also
re-reads the two dead `&` routes at closing (282 GETs) until a normal
incremental run confirms them.
Each page whose cards differ from its badge, or fall below its sticky surplus
or ceiling, adds one closing GET on every run that reads it, unless it repeats
its confirmed evidence.

Nonempty model destinations must match the requested literal model parent.
Explicit empty pages must retain their native model heading; labels containing `&` also accept the native `-and`
spelling. These checks do not claim simultaneous stability of model pages
that closing does not refetch.

Chunks perform at most eight serial GETs with a three-minute deadline. Each
request and complete body share a 20-second deadline. Transport waits 1.6 seconds
after body consumption on success and failure, including across chunk boundaries.
Runs stop at 1,024 GETs. Accepted HTML is bounded to 2 MiB; checkpoints are bounded
to 1 MiB, 64 makes, 512 models, 1,000 cards per page and 10,000 model rows.
Exceeding a bound preserves prior inventory and the last validated checkpoint.

`ChazCursor.initial`, `.parse` and `.serialize` preserve a strict source-tagged,
checksummed contiguous traversal prefix. The wire bound is checked before JSON
decoding. Checkpoints hold native tuples, controls and semantic fingerprints,
without HTML or materialized canonical arrays. The checksum detects corruption;
it is not authentication.

VIN or supported older serial, year, make, model, owned native destination and
verified yard identity are required. Destinations bind the native year and any
usable supplied stock. Missing or invalid optional stock, image, date, color
and yard-position values are nullable. Images must be same-stock references
under the MD08 CloudFront image prefix. Hidden gallery photographs are not
competing primary images. Optional metadata disagreements become null, including
disagreements across recent refreshes when a model agrees with one refresh.

All required VIN/YMM conflicts and destination collisions are classified before
callbacks. Paused chunks return zero vehicles, accounting and VIN presence.
Completion supplies disjoint accounting and independently valid rejected VIN
presence. Callback failure supplies no completed checkpoint. The 354-donor
floor, existing 10% rejection, 25% duplicate and 50% downstream drift guards
apply. The source runs by default; serving false from its source flag pauses it.

## Evidence and verification

Source packet: `.scratchpad/coverage/parallel-pa-md-wv/chaz-stage-a01/` and
`chaz-stage-b01/`. `frozen-union-report.json` pins the disjoint audit. Independent
reviews are `parallel-ny-nj-de/chaz-union-review01/report.json` and
`parallel-wa-or-id/chaz-source-semantics-review01/report.json`.

The application replay receipt is
`parallel-pa-md-wv/chaz-application01/offline-replay-report.json`. The real
parser, snapshot and connector read all 287 saved native bodies and reproduce
1,166 processed, 1,063 accepted, 49 rejected and 54 duplicate observations,
with three independently preserved rejected VINs. It performs 376 mocked
requests over 47 serialized eight-request chunks (historical: a full
traversal under the pre-incremental contract, not a current daily cost), with a peak 180,001-byte
checkpoint and only terminal callbacks for 1,063 donors and one yard.
All 1,063 VIN/YMM/destination identities and optional stock, image and date
values match the independently frozen candidate oracle after existing make
normalization.

Parent validation at `parent-chaz/replay-report.json` repeats the actual soak,
shared cursor codec, repository checkpoints, durable source validation and
reconciliation using saved bodies, in-memory libSQL and memory snapshot storage.
All 1,063 persisted donors match required and optional canonical fields. Three
seeded prior records whose valid VINs are independently observed remain intact;
one seeded absent record retires under the existing missing-inventory policy.
The resulting 1,066 live test rows include those three prior records, not three
additional accepted donors. Yard metadata and inventory counts persist together.
This proves local behavior, not remote database or checkpoint capacity.

The parent full suite passed 2,711 tests across 249 files. A subsequent tuple
annotation fixes a test-only TypeScript error; its four parser tests and the
workspace lint/typecheck pass. Source and shared-file formatting and diff checks
pass. The local admission is `chaz-local-admission.json`, with code and receipt
pins in `parent-chaz-application-validation.json`. Enablement was off at
qualification; the source now runs by default.

The independent application review at
`parallel-wa-or-id/chaz-application-review01/report.json` passed with no open
findings. Its shared-cursor replay matches these totals. Actual final
`onYards` and `onBatch` failures preserve the original error and return no
successful result or completed checkpoint for `Effect.fail`, `Effect.die`
and synchronous throws.

Replay closing requests reuse their captured opening bodies. They are mocked
closing controls, not fresh live closure evidence. A future authorized live run
must execute the runtime controls. No additional HTTP is required for this
offline qualification.

```sh
bun test src/server/ingestion/chaz-*.test.ts
```

Focused tests cover native parsing, explicit empties, display variants, strict
all-occurrence conflicts, optional metadata, source-quality bounds, serialized
resumption, premature callback prevention, malformed checkpoints, changed closing
controls and transport failure. `scripts/soak-chaz.ts` counts and discards results
while round-tripping production cursors. It owns neither transport nor admission.
