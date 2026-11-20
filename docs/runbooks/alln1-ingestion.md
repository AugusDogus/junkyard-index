# All-N-1 Auto Parts ingestion

See the current [source flags and census floors](provider-coverage-go-live.md).

## Grandpa John's tenant qualification, November 16, 2026

The same U-Pull connector now takes an explicit tenant contract. All-N-1 keeps
its source, native scope, cursor, admission rules and canonical output. Its
existing 600-donor test fixture has identical canonical bytes across budgets
1, 2, 3 and 32: SHA-256
`1ca9f680d8502ed80b686a0a144fcd0264d86540ccb7af0f76c5dfceb4b05a71`.

The new `grandpajohns` source runs by default;
`ingestion-source-grandpajohns` pauses it when it serves false. Grandpa John's Pick & Pull publishes
1746 Velp Avenue, Green Bay, WI 54303 and its self-pull statement on the
official root. Its inventory declares `iisupullurgid = 'WI25'` in the same
executable inline plugin contract as All-N-1. No phone is published there;
phone stays null rather than borrowing the neighboring full-service yard's.
The Census exact-address point is 44.552055694176, -88.053118559214.

Two complete pages contain 500 and 152 rows. The production connector accepts
636 unique donors and rejects 16 invalid identities
(2.45% overall, 14 on page one and two on page two), with no exclusions or duplicates. Grandpa John's uses `inventoryVinWithCheckDigit`; eight previously accepted
VINs fail ISO 3779 validation. Its 302 accepted native photo references survive
the WI25 stock and filename guard; foreign MO42 photos remain null.
The Grandpa John's yard floor is 212;
the existing 10% rejection cap, 25% duplicate cap and 50% prior-count drift
guard remain unchanged. Separately fetched closing owner and first-page
controls match. The native GET search for `1FMCU9GX9GUC13987` returns one
donor. Photos require WI25 and matching stock under the existing media guard.

Qualification used seven serial live requests, including the owner, two
inventory pages, two closing controls, Census and one VIN search. Offline
fixtures and receipts live in `src/server/ingestion/alln1-test-fixtures/`.
Budgets 1, 2, 3 and 32 replay identically through the durable cursor codec;
another tenant's cursor or origin cannot be resumed. The count-only driver
also accepts `--sources=grandpajohns`.

Status on November 12, 2026: saved-only production connector replays accept
1,093 unique vehicles from 1,158 native rows, with 65 rejected and zero
duplicates. Budgets 1, 2, 3 and 32 produce identical canonical output through
the actual shared durable cursor codec. No production inventory was written;
the source runs unless its pause flag serves false.

The source is `alln1`, yard `MO42`, All-N-1 U Pull & Metals Recycling,
operated by All-N-1 Auto Parts at 2408 Blue Ridge Blvd, Kansas City MO 64129,
phone 816-252-3930. The official [root](https://alln1kc.com/) publishes the
matching address, phone and self-service junkyard description. Native inventory
pages publish `var iisupullurgid = 'MO42';` in an inline script.
Scope requires the complete native flat block of quoted variable declarations
in an executable inline JavaScript element. Comments, quoted source text,
deferred function bodies, external fallback text, inert script types and inert
HTML containers cannot supply that proof.

Coordinates 39.07918, -94.471004 come from the separately labelled UPullScan
exact-address LocalBusiness point saved at
`.scratchpad/coverage/new-leads/priority2-profile-all-n-1-auto-parts-kansas-city-mo.html`.
The native map publishes a viewport center rather than a separately verified
rooftop marker. The directory point must retain its third-party provenance.

## Native traversal and destinations

The unfiltered native first page is
`https://alln1kc.com/inventory/ANY/ANY/?k=1&view=table`.
The connector follows the actual same-origin Next link, adding `&pagenum=2`
and `&pagenum=3` in the saved source. It never adds a Midway `id=MO42`
selector. Every page must publish the exact nine columns Image, Year, Make,
Model, Row, Date, Vin, Stock # and Fresh Set. Each donor has one image `th`
followed by eight `td` cells.

Both native pagination controls must agree on a complete sequential numbered
directory, one active page, exact Previous/Next targets and terminal absence
of Next. Nonterminal pages contain exactly 500 rows. The source is bounded to
20 pages and 10,000 rows. The native inventory statement, inline yard scope,
unfiltered GET form and table configuration must remain verified. Empty,
truncated, duplicate, malformed, filtered or foreign continuations block the
snapshot. Complete trailing CMS cache comments after `</html>` are accepted.

The saved traversal has 500, 500 and 158 rows. Canonical `detailsUrl` uses
the native GET search form with `k=1`, `view=table` and
`search=<validated native VIN or supported serial>`. The exact published
control was verified with
`https://alln1kc.com/inventory/ANY/ANY/?k=1&view=table&search=2GNALCEK8F6347168`.
Other donor destinations follow that same form contract without individual
requests, image requests, login, cart or inquiry submission.

## Identity, availability and optional metadata

Admission requires a native modern VIN or supported pre-1981 serial and
usable native year, make and model under the shared `inventoryVin` contract.
Two supported legacy serials survive in the saved source. Native model labels
remain complete, including labels such as `FORD F150 PICKUP`; no VIN-derived
year or guessed model correction is substituted.

Literal row positions `HOLD`, `YARD VAN` and `REBUILDER` have unproven donor
availability. The connector quarantines them without assigning native status
meanings. All 50 HOLD, three YARD VAN and four REBUILDER rows count toward
rejection, together with eight invalid required identities. Their 57 valid
identities remain presence-only evidence, preserving known inventory during
reconciliation. None are ordinary outside-scope exclusions.

Color is absent and remains null. Missing or unusable stock, row, source date
or photo becomes null without rejecting an otherwise valid donor. Genuine
stock and row values remain native, including internal row spacing such as
`V V-11`. The source's seven-digit stock `2692320` belongs to a quarantined
HOLD row and remains unchanged in evidence and checkpoints. It is not
truncated or repaired.

Valid source dates remain exact calendar strings such as `2026-11-04`.
No source timezone or UTC instant is inferred. Invalid calendar dates become
null. Fresh Set is retained in the native record fingerprint and does not
replace the published Date field.

Photos survive only when one native main image and its anchor publish the
same HTTPS URL at `da8h1v3w8q6n5.cloudfront.net`, with both path stock values
matching that donor's native stock under
`/mo42/images/<stock>/<stock>_<digits>.jpg`. Placeholders, mismatched or
malformed media become null. Published `_0.jpg` references remain source
references without guessed placeholder semantics. Current table media wins
over older grid evidence. Accepted output contains 654 photo references and
439 null photos. No image bytes are fetched.

## Cache bypass

Both tenants sit behind a Cloudways Varnish cache. On November 19, 2026 the
canonical All-N-1 page 1 was a cache HIT 145,950 seconds old, page 2 a HIT
120,868 seconds old and page 3 a fresh MISS. The last 12 donors of cached page
2 were the first 12 of fresh page 3, and the closing owner and first-page
re-reads returned the same cached bytes as the opening reads.

Every inventory request (catalog pages, opening, resume and closing anchors,
and Set Date searches) adds a fresh random `cb` nonce, for example
`/inventory/ANY/ANY/?k=1&view=table&cb=<16 hex>&pagenum=2`. A unique `cb`
missed the cache with `age: 0` and `cache-control: no-cache` in live checks.
The plugin reflects `cb` as a hidden search field and in every page link. The
parser accepts that reflection only when it equals the nonce the page was
requested with, and strips it from continuations, so cursors, page hashes and
scope hashes stay canonical. Any inventory response with an `x-cache` HIT, a
`cf-cache-status` of HIT, STALE, UPDATING or REVALIDATED, or an `Age` other
than 0 fails closed with the URL and those headers. Previous inventory is
preserved; re-verify that a unique `cb` still bypasses the cache before
retrying.

The owner page proves only the yard's physical identity text, not an
inventory snapshot, so it is read as published and may come from the cache.
`/?cb=` also missed on November 19 (MISS, age 0), but took 19.3 seconds at the
origin, so busting it would add about 40 seconds to every chunk for no
completeness gain. Owner identity and opening/closing owner equality checks
are unchanged.

## Set Date ties

The table is sorted by Set Date with LIMIT/OFFSET on that non-unique key, so
each offset can order a date's donors differently. Dates still fill fixed,
contiguous runs of slots. A donor of a date split across a page boundary can
therefore show on both pages while another donor of that date shows on
neither. The fresh November 19 census shows this: stock 261947 ends page 1
and starts page 2 (Set Date 2026-08-28), and 261948 appears on neither page.

A repeat is accepted only as the identical native record from the
immediately preceding page, dated with both that page's last Set Date and the
current page's first. It is counted once as a duplicate row and never
admitted twice. Every other VIN, stock or record repeat still fails, and so
does a repeat once the catalog stops being ordered by Set Date. Each repeat
stands for exactly one hidden donor of that date. Pending tie dates, their
repeat counts and the census donors of each date are kept in the checkpoint,
so a tie found in one chunk is resolved in the last.

Once every page is admitted, one host turn runs one cache-busted search per
tie date, `/inventory/ANY/ANY/?k=1&view=table&cb=<16 hex>&search=YYYY-MM-DD`,
then the closing reads. A search must pass the same scope, statement, form and table
checks, reflect the searched date, publish no pagination, hold 1 to 499 rows,
all dated that day, list every census donor of the date, and add exactly as
many unseen donors as the catalog repeated. Anything else means inventory
changed during the crawl: nothing is accepted, previous inventory is
preserved, and the next run starts over. Recovered donors go through the same
transform, identity and 10% yard rejection checks, and the run warns with the
recovered dates. The live 2026-08-28 search (MISS, 19.6 s at the origin)
returned 16 rows including 261948, and the fixture census accepts 1,079 unique
donors with 45 rejected and 1 duplicate row.

## Checkpoints, quality and recovery

The strict cursor phases are `start`, `pages`, `closing` and `complete`.
`closing` holds a census whose every page is admitted while its Set Date
searches and closing reads are still pending. A paused cursor
stores owner/scope and first-page anchor hashes, last/next page, exact Next
URL, sequential per-page receipts and cumulative available, incomplete or
quarantined donor states. Each state retains its native record fingerprint,
usable stock, valid identity or presence, first page and ambiguous position
where applicable. A checksum binds every resume-relevant field and is
validated before HTTP, alongside accounting and unique stock/identity guards.
This detects corruption in trusted internal durable state; it is not
authentication against coordinated arbitrary cursor rewrites.

Every `start` or `pages` chunk opens the official root and first-page
inventory anchor. Resumes must match the prior owner, scope, anchor and page
directory. Terminal completion runs the Set Date searches, then rereads the
root and first page, which must match the opening owner, scope and anchor. A
`closing` chunk makes only those reads, so they are also its resume check. All chunk validation finishes
before callbacks. Callback failure returns no advanced checkpoint; a complete
cursor makes no requests or callbacks. The default chunk has three pages,
and connector budgets range from 1 through 32.

The unchanged 10% rejection cap applies to the complete yard, not a partial
page or checkpoint. Page one legitimately pauses at 58 rejected of 500 rows
(11.6%). Complete accounting is 1,158 processed, zero excluded, 65 rejected
(5.61%), zero duplicates and 1,093 accepted. Shared admission requires at
least 364 accepted unique donors and retains the 50% prior-count drift limit
and duplicate/reconciliation guards. Partial or failed snapshots cannot
reconcile inventory.

Requests use the shared 1.6-second gate, no retries, one 60-second budget
for each read's headers and body together. The chunk's work budget is the
chunk wall limit, not a fixed three minutes, so every shared host turn ends by
the turn horizon first.
A 60-second read fits inside the 110-second URG host turn for one request.
Uncached origin pages took 18 to 26 seconds on November 19, 2026 (page 1 26.0
s, page 2 19.4 s, page 3 18.2 s, the 2026-08-28 search 19.6 s by `cfOrigin`).
A fresh three-page chunk with one tie makes seven reads (owner, three pages,
one search, closing owner, closing page 1), about 105 seconds of origin time
plus a 3.5-second host gap after each, roughly 130 seconds and about 190
seconds when the root is also uncached. Each further tie date adds about 23
seconds. Time queued for a shared URG host turn does not count as work. No
turn combines a catalog page with the finishing reads: the opening turn holds
at most the owner, the anchor and one page, each later page has its own turn,
and the finishing turn holds the T tie searches and the two closing reads. At
the 60-second read limit plus gaps, three ties fit the 340-second turn
horizon, so one turn holds at most three tie searches
(`ALLN1_MAX_TIE_SEARCHES`). A census with more split ties fails closed before
searching, naming the tie dates; that needs tie searches split across turns.
All-N-1 (three pages) has at most two ties and Grandpa John's (two pages) one. On a slow origin the finishing turn can run past the horizon; it is
then deferred, the chunk returns a `closing` checkpoint, and the next chunk
makes only the finishing reads. The tests replay the captured census with
every read, the root included, at up to 59 seconds: it completes in two
chunks. Only complete unredirected HTTP 200
`text/html` from the verified destination is accepted. Partial ranges, length
mismatches, invalid UTF-8 and bodies over 4 MiB fail closed. Preserve prior
accepted inventory on failure, inspect native ownership, scope and pagination,
then retry from the last validated checkpoint. A changed anchor requires a
fresh complete crawl.

The native source exposes no transaction token or independent total count.
Complete ordered continuation, first-page anchors and duplicate guards cannot
prove atomicity against every interior-only concurrent edit. Fresh reads do
not change that: pages are 500-row offsets ordered by Set Date, so a donor on
page 2 or later that departs between page reads shifts later rows up and one
row is skipped without a duplicate or a changed first-page anchor. These
limits remain explicit when interpreting a completed snapshot.

`scripts/soak-alln1.ts` is a count-and-discard driver. The caller supplies the
connector and callbacks; it does not write inventory. Its total page budget is
1 through 20. Production enablement is a separate decision.

## Saved verification

Native table pages, receipts, verified VIN search, donor outcomes and metadata
are under `.scratchpad/coverage/parallel-al-ms-la/alln1-requalification/`.
The independent source review is
`.scratchpad/coverage/parallel-mn-ia-ne-sd/alln1-source-review/final-source-review.json`.
The frozen independent canonical oracle and 57 presence identities are under
`.scratchpad/coverage/parallel-mn-ia-ne-sd/alln1-code-review/`.

The saved-only replay driver is
`.scratchpad/coverage/parallel-az-nm-nv/alln1-plan/replay-alln1.ts`.
It refuses unsaved requests and round-trips every chunk through
`serializeDurableSourceCursor` and `parseDurableSourceCursor`. Reports,
canonical output, input hashes and largest serialized checkpoints are in its
`evidence/` directory. Budgets 1, 2, 3 and 32 use 10, eight, six and six
cached calls, with zero live calls, photo calls or production writes. The
largest paused serialized checkpoint is 155,548 bytes.

Every replay matches the independent oracle on all canonical fields and all
57 presence identities. Canonical SHA-256 is
`a6e7693dd9427b062cd3c20a31696d30d7e2d8ef0467dbaab2e4d8cb51c75c64`.
Independent canonical and physical-overlap verification is recorded in
`.scratchpad/coverage/parallel-ky-tn-ar/evidence/alln1-overlap-verification.json`.
Saved opening and closing reads reuse captured bodies; focused negative
controls separately exercise scope drift, corruption and callback failure.
