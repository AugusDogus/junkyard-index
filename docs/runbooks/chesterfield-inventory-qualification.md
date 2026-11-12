# Chesterfield inventory qualification

Parent admission at 03:35 UTC on November 12, 2026 qualified Richmond, Fort Lee
and Southside, Virginia locally, with the source disabled and unpublished.
That admission is recorded in `.scratchpad/coverage/chesterfield-local-admission.json`.
The policy replay below validates the updated connector against the same
completed current crawl. Parent owns the updated application admission.

## Current required-field policy and replay

The user-confirmed policy at 05:00 UTC matches existing providers: color,
canonical stock, photo, source date and yard position are optional. Missing
or invalid optional metadata becomes null. VIN or supported older serial,
year/make/model, physical-yard ownership, active availability, complete native
traversal and the existing rejection, duplicate and reconciliation guards remain
required. Chesterfield's twelve-digit native stock remains a traversal and
ownership identifier, independently of nullable canonical stock metadata.
Explicit HOLD or CRUSH positions retain their active-availability exclusion;
missing or unknown positions become null.

A missing or invalid photo reference needs no preservation. A valid published
photo still requires verified bytes and readback before emission. Its transport
or storage failure stops the chunk without accepting an advanced checkpoint.
Photo-backed checkpoints retain their existing shape; photo-free checkpoints
store paired null photo hash and native blob identity. Multiple missing photos
do not count as shared image ownership.

The 05:22 UTC offline replay uses the authoritative current crawl completed at
03:27 UTC, starting at its saved, fully enumerated inventory checkpoint. It
verifies all 226 original chunk hashes and 2,534 native HTML hashes, replays all
2,138 exact native queries through the modified connector, and reaches an
accepted complete cursor across 349 serialized chunks.

| Yard      | Observed donors | Admitted donors | Rejected | No photo |
| --------- | --------------: | --------------: | -------: | -------: |
| Richmond  |           1,027 |           1,026 |        1 |        8 |
| Fort Lee  |             592 |             591 |        1 |        2 |
| Southside |             625 |             620 |        5 |        1 |

The replay processes 2,269 observations: 2,237 admitted donors, seven required-field
rejections and 25 repeats. Sixty-eight emitted colors and one position are null.
All 2,226 published-photo donors pass application response readback; the other
11 emit null images. The existing current cache supplies 2,157 photos. The 69
newly admissible donors with published images required 138 bounded public photo
requests at the unchanged 1.6-second gate, with no failures or retries. Their
original bytes are retained separately from the authoritative crawl evidence.

The connector replay makes zero public source requests, discards canonical
batches locally and performs no production or live Blob writes. Source validation
accepts the terminal result with no errors. No previous production-accepted count
was supplied. The maximum serialized checkpoint is 891,745 bytes. Existing
required-field, ownership, drift, byte, pixel, MIME and rejection limits remain
in force. All 69 Chesterfield tests, targeted lint and formatting checks pass.

Evidence is in
`.scratchpad/coverage/parallel-mt-wy-nd/chesterfield-policy/`:
`current-field-replay.json`, `current-source-index.json`,
`current-photo-catchup.json`, `current-photos/` and
`current-connector-replay.json`. The older 2,200-donor snapshot diagnostic is
historical and does not replace these current totals. The section below retains
the prior strict-field admission and its original counts.

## Completed current live qualification

The live crawl ran from 00:17 to 03:27 UTC across 226 serialized durable chunks.
It completed all 2,138 native queries, recovered all 120 fresh newest-car
controls and emitted 2,157 complete donors. Its 6,928 committed public requests
include the 80 starting-directory/control requests. The failed timeout attempt
made 26 additional uncommitted requests and did not advance its checkpoint.

| Yard      | Observed donors | Complete donors | Rejected | Rejection rate |
| --------- | --------------: | --------------: | -------: | -------------: |
| Richmond  |           1,027 |             991 |       36 |          3.51% |
| Fort Lee  |             592 |             570 |       22 |          3.72% |
| Southside |             625 |             596 |       29 |          4.64% |

All three satisfy the unchanged 10% per-yard rejection limit. There were 25
repeated query sightings, giving 2,269 total processed observations. Source
validation accepted the explicit complete cursor. Every emitted donor passed
the application field gate and local photo readback.

The independent offline audit verified 2,534 native HTML hashes, every exact
query and newest control, all 226 cursor round trips and all 2,157 decoded donor
photos. The last seven donors link to photo receipts captured from their
original live responses; the other 2,150 retain committed cursor linkage.
The audit helper initially misread native selects without an explicit
`selected` attribute. Its correction implements the native first-option default,
with saved HTML regression controls. Failed receipts remain preserved.
Application code, source data and quality guards did not change for this fix.

Terminal receipts are in
`.scratchpad/coverage/parallel-ut-co-ok/chesterfield-review/terminal-review.json`
and `terminal-application-review.json`. Parent admission verifies that the
reviewed application code hashes still match. The live run's original progress
receipt retains `qualified: false`; the separate parent admission records the
subsequent qualification decision without rewriting the crawl evidence.

This is a time-separated public crawl, not an atomic inventory snapshot.
Physical-site screening uses the saved 213-entry directory and official yard
metadata. The historical 180-donor overlap sample does not prove catalog-wide
exclusivity. No prior production-accepted count was supplied. Production photo
storage and delivery remain untested. No deployment, production write, source
enablement or publication occurred.

The sections below preserve earlier snapshots and intermediate checkpoints.
Their pending-qualification statements describe those earlier increments;
the terminal admission above supersedes them.

## Native traversal

The official [inventory form](https://chesterfieldauto.com/search-our-inventory-by-location)
uses a public make selector followed by a same-session model search:

```text
GET /search-our-inventory-by-location?SelectedMake.Id=<native make ID>
POST /search-our-inventory-by-location?SelectedMake.Id=<native make ID>

SelectedMake=<native make ID>
BasicSearch.ModelId=<native model ID>
BasicSearch.BeginYear=1962
BasicSearch.EndYear=2026
__RequestVerificationToken=<value from the current public form>
```

The current form declares 1962-2026 as its year-input bounds. All 73 published
make directories were collected, yielding 2,138 exact make/model filters.
This required 72 new directory requests and reused the fresh Honda control.
The directory and its native query traversal are complete. A native model-zero control
returns no rows, while a same-session Accord control returns 73 donors. An empty
broad control must not be treated as an empty catalog or used for enumeration.

Search results contain a server-rendered ten-column table. Donor photo dialogs
bind a native stock number and make-prefixed VIN to the corresponding row.
The collector preserves year/make/model, color, body, engine, yard position,
source set-date and published image URLs. It never invents missing stock or
VIN values when a dialog is absent. Position strings remain intact, without
invented section/row/space subdivisions.

The collector uses one session, current form verification tokens, a 1.6-second
request gate, 30-second request timeouts and an 8 MB response bound. Every result
must retain the requested make/model selection and the expected table shape.
An empty result needs the native no-matches confirmation. Unprocessed pagination,
500 or more result rows, changed year bounds, changed cache hashes and transport
failures stop the audit. The row bound is a conservative audit guard, not a
proven provider limit. No failed page is marked completed.

## Field and photo checks

The saved field report applies the existing `inventoryVin`, canonical make and
color helpers, plus explicit known-color, stock, source-date, position and photo
reference checks. Unknown color abbreviations and absent photos stay rejected.
Subset rejection rates cannot establish full-catalog compliance with the
unchanged 10% per-yard limit. A photo reference is not proof that every image
loads or depicts the correct donor.

The completed traversal recovered 2,200 distinct yard/stock donors from 2,225
observations. There are 25 repeated observations, no conflicting descriptions,
no unidentified observations and no VIN ownership conflicts. Of these donors,
2,111 pass field admission and 89 remain rejected. Earlier bounded snapshots
are preserved separately. The application donor module independently reproduces
the full field audit, including every per-yard rejection count.

| Yard      | Observed donors | Pass current field checks | Rejected |
| --------- | --------------: | ------------------------: | -------: |
| Richmond  |             989 |                       953 |       36 |
| Fort Lee  |             592 |                       570 |       22 |
| Southside |             619 |                       588 |       31 |

Rejections include unknown colors, absent qualifying photo references, invalid
identities and one unverified position. Full-catalog field rejection rates are
3.64%, 3.72% and 5.01%, respectively, below the unchanged 10% limit. Photo
preservation and offline connector admission now pass for this saved snapshot.
The separate current live traversal remains unfinished.

A fresh native newest-vehicle page at 21:14 UTC contains 120 donors, 40 per
yard. The completed traversal recovers all 120 controls with no identity
mismatches. All control makes occur in the collected directory, and their
1970-2017 years fall within the source's published search bounds.

### Later freshness discrepancy

At 00:03 UTC on November 12, a fresh 120-donor newest-car control contained
64 identities absent from the entire saved catalog: 39 Richmond and 25
Southside. The other 56 controls have no catalog identity mismatches. The
directory-resumption application control stopped after six requests, before
inventory searches, photos or donor emission, because its expected controls
belonged to the earlier snapshot. It produced no accepted inventory-start
cursor. Its failed receipt and log remain preserved.

A four-request same-session diagnostic at 00:08 UTC compared two exact native
queries with their hash-verified saved HTML. Acura TL changed from nine to
11 donors, adding Richmond stocks `000000086763` and `000000086677`.
Chevrolet Captiva Sport changed from two to three, adding Southside stock
`000000084908`. All three appear in the subsequent newest-car response with
source set-date November 11. Neither query lost an older donor or changed an
older donor's stable descriptive fields. The original extraction exactly
matches the original HTML. These three discrepancies are source-response
changes, not rows omitted while parsing the saved responses. The underlying
provider update time is unknown.

The targeted audit finished at 00:11 UTC. All 64 controls occur in their
refreshed exact native queries and were absent from the hash-verified saved
HTML. Across 53 query partitions, the source responses contain 64 additions,
nine removals and no changed stable descriptive fields. It reused the two
completed controls and made 52 additional public requests, including one
bootstrap. No failed request was retried. This establishes source-response
changes for every discrepant control, not the underlying provider update time
or current full-catalog completeness.

An offline application-parser replay verifies all 53 fresh response hashes
and matches the independent extraction for 916 observations. Descriptive engine
whitespace is normalized; identities and image URLs are exact. The 120 newest
identities were stable across the diagnostic's two newest-page captures.
Fresh responses remain separate from the earlier snapshot. This is a
diagnostic, not a complete refreshed crawl.
The original donor input and replay script remain unchanged while the photo
and offline-replay jobs finish. A terminal replay of the older snapshot alone
cannot qualify the current catalog. No Chesterfield yard is counted or enabled.

Evidence is in
`.scratchpad/coverage/new-leads/chesterfield-late-freshness-controls/`:
`newest-comparison.json`, `native-query-freshness-diagnosis.json`,
`targeted-query-manifest.json`, `application-freshness-parser-replay.json`
and their preserved native HTML responses.
The failed application control is
`chesterfield-enumeration-controls/application-live-directory-resume.json`.

The separate fresh directory-resumption control passed at 00:14 UTC:
80 public requests across six serialized chunks recovered all 73 makes, the
same 2,138-query plan, all 120 fresh controls and the three official yard
metadata records. It stopped at the inventory-start checkpoint without an
inventory search, photo request or emitted donor. The earlier failed control
was not overwritten. Fresh proof and cursor files are
`chesterfield-late-freshness-controls/application-live-directory-resume.json`
and `application-live-inventory-start-cursor.json`.

A separate current live connector crawl now starts from that checkpoint. Each
invocation of `.scratchpad/coverage/advance-chesterfield-local-live.ts` processes
one 32-request chunk. It uses the actual application connector, fetches native
inventory and original donor photos, preserves bytes on local disk and checks
application photo readback before committing its serialized cursor. Native
HTML and canonical donor batches remain local in `chesterfield-live-current/`.
Partial source validation must reject the unfinished crawl. A file lock prevents
concurrent invocations, and an orphaned chunk or provider failure requires
inspection before resumption. This does not reuse simulated photo responses
from the older offline replay and does not write to live Blob or production.

An independent offline review of the committed 00:46 UTC checkpoint passed
for 355 complete donors across 34 chunks. It separately parses preserved HTML,
compares required donor fields, joins native stock/VIN and photo identities,
decodes every preserved image with Pillow, verifies content hashes and reconciles
the emitted and rejected counts. It checked 309 distinct native HTML hashes.
The partial per-yard observations are Fort Lee 107 complete and one rejected,
Richmond 168 complete and two rejected, and Southside 80 complete and five
rejected. These are partial quality observations, not final yard admission.

The repeatable read-only review is
`.scratchpad/coverage/review-chesterfield-live-checkpoint.py`; the initial receipt is
`chesterfield-live-current/independent-checkpoint-review-chunks-00034.json`. The receipt
identifies the exact state hash and committed chunk hashes, so a later live
checkpoint does not invalidate its stated scope. The first review attempt
read the variation token instead of the blob token. Its harness failure is
preserved separately; the corrected review passes without changing provider
data or the application. A terminal chunk that has cleared the cursor's photo
mapping requires separate review, and this helper fails rather than inferring
that missing linkage. No current Chesterfield yard is qualified or counted.

The expanded 00:53 UTC review passed for 466 complete donors across 43 chunks
and 355 distinct native HTML hashes. It independently reconstructs the native
identity hashes used by the 120 fresh newest-car controls. Eighteen controls
have been processed and match; twenty occur in the fetched native response
prefix. The remaining controls are pending, not missing from a completed crawl.
Terminal review requires all 120 controls and no yard above 10% rejection.
Current partial yard counts are Fort Lee 130 complete / three rejected,
Richmond 219 / three and Southside 117 / six. The fixed receipt is
`chesterfield-live-current/independent-checkpoint-review-chunks-00043.json`;
`independent-checkpoint-review.json` points to the latest review. Each expanded
receipt also hashes the review script. This remains partial evidence and does
not replace terminal source validation, metadata or destination review.

The 01:09 UTC review extends this to 690 complete donors across 62 chunks and
484 distinct native HTML hashes. All 32 processed newest controls match their
native identities. Required canonical fields contain no blank or placeholder
markers, and no emitted source inventory date is in the future. This separate
placeholder control covers 528 distinct published positions. Partial yard
counts are Fort Lee 197 complete / four rejected, Richmond 319 / seven and
Southside 174 / six. The fixed receipt is
`chesterfield-live-current/independent-checkpoint-review-chunks-00062.json`.

A nine-image contact sheet, three samples per yard, was visually reviewed from
this fixed prefix. Six samples are later freshness controls absent from the
older catalog. All nine show donor vehicles or donor interiors; no generic
placeholder was observed in the sample. Appearance was not used to infer VIN,
stock, color, date or position. The sheet, exact image hashes and limited-scope
review are `chesterfield-live-current/current-prefix-photo-contact-sheet.jpg`
and `current-prefix-photo-visual-review.json`. This sample does not establish
catalog-wide photographic truth or terminal qualification.

### Yard metadata, overlap and destination

The official form footer publishes the following metadata. Coordinates come
from its business-place directions links. Fort Lee also has a separate address
pin; do not substitute that pin or the map viewport.

| Native yard | Address                  | City / ZIP             | Phone          | Business pin            |
| ----------- | ------------------------ | ---------------------- | -------------- | ----------------------- |
| Richmond    | 5111 Old Midlothian Tpke | Richmond VA 23224      | (804) 233-5481 | 37.5070309, -77.4922793 |
| Fort Lee    | 4855 Puddledock Rd       | Prince George VA 23875 | (804) 732-9253 | 37.2468736, -77.3669944 |
| Southside   | 12910 Genito Rd          | Midlothian VA 23112    | (804) 744-0716 | 37.4510689, -77.6318571 |

A duplicate screen against all 213 published entries found no matching
normalized address and no published pin within 200 meters. This is a directory
screen, not an independent physical-site census.

A refreshed stock-spread sample of 180 donors, 60 per yard, drawn across the
completed catalog had zero exact-VIN matches in Row52 active inventory or AutoRecycler.
Every filtered batch recovered its fresh positive control. The audit completed
18 batches using 38 public requests. Row52 batches contain ten sample VINs plus
the control; a larger initial filter exceeded its documented 100-node limit.
This proves sample non-overlap only; do not claim catalog-wide exclusivity. The
earlier 644-query sample remains in `overlap-controls-bounded644/`.

No direct vehicle URL or persistent matching-inventory GET URL is established.
The public GET opens an empty form; same-session POST returns matching donors.
The VIN is source-verified in native modal attributes but is absent from visible
result text. Stock is visible in the corresponding Pics dialog title. A future
manual destination must say **Search provider inventory**, with this explanation:

> Select make, model and years, find the matching yard, then open Pics and match
> the stock number.

These are native HTML/form controls, not browser runtime QA. Do not imply a
direct vehicle link or instruct users to match a VIN that the page does not show.

All photo URLs retain the provider's published signatures. Earlier fresh photo
controls returned actual donor images through expiring Rails/S3 URLs. The
application's existing URL cache and image loader do not establish durable
delivery after expiry. Full traversal alone cannot resolve this requirement.
Do not strip signatures, construct alternate URLs or publish these URLs as
durable listing images.

### Local photo-preservation proof

Ten donor-bound JPEGs were downloaded unmodified on November 11, using 20
public requests. The selection covers three stock-spread donors per yard and
one previously expired-URL positive control. Each image was decoded, bounded
to 4 MB and 16 million pixels, hashed and saved under its SHA-256 filename.
All ten hashes differ. Visual inspection of the contact sheet shows actual
donor vehicles or their interiors, with no generic placeholder in this sample.
The source dialog supplies the stock/VIN binding; appearance alone does not
independently verify donor identity or descriptive fields.

A separate process verified all ten saved images with its HTTP client and
socket connections disabled, making zero network attempts. A deliberately
corrupted copy was rejected; the original cached files were preserved. The
Fort Lee control, stock `000000085373`, uses the same published blob identity
as the earlier URL that returned HTTP 404 after expiry. Its fresh, unmodified
reference returned bytes identical to the earlier saved photograph.

This establishes local preservation for the sample. Source signatures do not
need to be changed to retain the image bytes. The first proof did not create
an application delivery path. The local implementation below extends that work;
full traversal, catalog-wide media/quality checks and connector integration
remain admission requirements.

### Local application parser and photo delivery

The local [native parser](../../src/server/ingestion/chesterfield-parser.ts)
now reads form directories, complete result tables and stock-bound photo dialogs.
An independent replay of all 2,138 saved searches and all 120 newest-car controls
matches the collector's fields. Only descriptive layout whitespace is normalized;
VIN, stock and signed image URLs are compared exactly. The replay verifies native
response hashes and makes no source requests. This completes the native parser
replay, not a terminal connector crawl.

The local same-session client maintains anonymous cookies and rotating public
form tokens in memory. It rejects changed year bounds, make directories and
unfulfilled filters. A fresh two-request application control at 22:20 UTC found
73 Accord donors, matching the completed traversal with no added, absent or
conflicting identities. No form state is persisted in a durable cursor.

The [photo preservation path](../../src/server/ingestion/chesterfield-photo.ts)
fetches the published references unchanged, follows at most four hops through
the two verified storage hosts and validates complete JPEG or PNG bodies within 4 MB
and 16 million pixels. It decodes the image before preserving the original bytes.
Native filenames vary; the stable blob and variation identities come from the
published Rails tokens, not a guessed filename or a modified signature.

The [photo store](../../src/server/ingestion/donor-photo-store.ts) uses the
existing private Blob service under `donor-photos/<sha256>`, separate from
disposable ingestion snapshots. A write is accepted only after uncached readback
matches its content hash and original bytes. Its public application route is
`/api/inventory-photos/<sha256>` and reads preserved bytes only. Missing or
unavailable storage returns an error, without an expiring-provider fallback.
The route returns immutable responses with the decoded image MIME after verifying
the stored bytes. JPEG and PNG files remain unmodified.

A separate process served all ten earlier donor-bound sample files through the
application response helper with HTTP and sockets disabled: zero network attempts.
The completed catalog has 2,111 distinct primary native blob identities for its
2,111 field-complete donors, with no missing or shared primary identity.
Native blob identity uniqueness does not prove distinct image content across
the full catalog. Private Blob behavior is tested using an injected SDK double;
no live Blob writes, deployment, production image delivery or catalog-wide image
preservation had been performed at that increment. The source is now registered
locally with a disabled default; no source has been enabled.

### Completed local photo preservation

A separate resumable audit completed preservation of the primary photo for each
of the 2,111 field-complete donors at 00:19 UTC on November 12, using the
application photo module. Its terminal manifest reports `photos_complete` and
4,224 total public photo requests across the original and resumed runs. The local
disk adapter decodes and hashes every JPEG or PNG, independently reads it back and
rejects a shared content hash across different donors. It preserves published
references unchanged and uses the existing 1.6-second request gate. The
4,500-request run budget covers the observed two-hop paths and is a bound, not
permission to accept partial work. Failures retain prior files and stop the run.

Evidence lives in `photo-catalog/manifest.json` and `photo-catalog/photos/`.
The terminal manifest contains all 2,111 donor identities with distinct native
photo identities and content hashes: 2,108 JPEGs and three PNGs. Tool session
`78527` exited zero. Its log is
`.scratchpad/coverage/chesterfield-catalog-photos-resume.log` and its coordination
receipt is `.scratchpad/coverage/chesterfield-photo-session.json`. Preserve this
completed proof instead of restarting the downloader. No live Blob write or
source enablement is part of this audit.

The original photo run, session `42458`, exited with status one after preserving 430 JPEGs.
Its next donor, Southside stock `000000086613`, publishes a valid PNG as its
primary image. A bounded unchanged-reference control returned HTTP 302 followed
by HTTP 200 `image/png`, 248,976 bytes, with no range response. Visual inspection
confirmed an actual red donor car. The JPEG-only application bound caused the
failure. The preserved failure manifest and native control remain in
`photo-catalog/failed-jpeg-only-manifest.json` and `failed-photo-control.json`.

The application now admits single-image JPEG and PNG responses, verifies the
declared MIME against full decoding, and retains the same byte, pixel, content
hash and ownership limits. The resumed audit reverified the original 430 files,
preserved the PNG unmodified and continued past it. Its hash is
`9995dfa95f6488d8e386a60f6b59683a3a1fa58a3f6de5c124decd0a0a43ceb4`.
No provider URL was changed and no format conversion occurred. A separate
application response check read back the preserved PNG with HTTP disabled and
zero network attempts. Its evidence is `photo-catalog/png-control-preservation-proof.json`.

### Disabled resumable connector

The local connector collects the independent newest controls and all native
make/model directories, then processes exact queries within a 16-request chunk
budget. Serialized cursors retain compact donor identity, description and media
hashes, without cookies, form tokens or expiring photo URLs. A resumed partial
page must match its stable fingerprint and prior-row ownership evidence. Changed
pages, contradictory repeated records, shared VINs, native photo identities or
image content stop the crawl. Each yard must remain within the 10% rejection
limit independently. Completion requires recovery of every saved newest control.

Field-complete donors emit only after byte preservation and readback. The
canonical position remains intact in `row`, and the destination uses the manual
search instructions above. Source registration, durable cursors, fetch dispatch,
validation, reconciliation priority and search labels are integrated locally.
Missing or unreadable flags default this source to disabled. The read-only soak
uses memory-only photo storage and discards canonical batches.

A six-request public connector control at 22:44 UTC verified all three footer
metadata records, all 73 makes, 120 newest controls and four model directories.
It paused with zero donors, as expected. It is not a full live connector crawl.
The earlier offline replay committed 176 donors across 22 serialized chunks,
then stopped at an uncached photo. Its partial validation was rejected and its
receipt is preserved as `application-connector-partial-replay.json`.

After photo preservation completed, the terminal offline replay passed at
00:22 UTC: 342 serialized chunks, 2,212 distinct native response hashes verified,
2,225 processed observations, 2,111 emitted donors, 89 rejected donors and
25 repeated observations. All 2,111 application photo responses matched the
preserved bytes. Source validation accepted the terminal result with no errors.
The largest checkpoint was 868,220 bytes and retained no signed photo URLs or
public form tokens. This used zero public source requests, production writes
or live Blob writes. Its counts match the independent audit exactly. This
proves the saved snapshot, not current live completeness or source qualification.

The current code passes all 1,406 application tests, lint and typecheck.
The connector has 16 passing guard tests. The replay and audit helpers pass strict
typecheck. Receipts are `.scratchpad/coverage/chesterfield-connector-suite.log`,
`chesterfield-connector-check.log`, `chesterfield-png-tests.log` and
`chesterfield-connector-replay-typecheck.log`. Native controls and the partial
replay are `application-connector-live-control.json` and
`application-connector-replay.json` in the evidence directory.

## Evidence and recovery

Receipts are in
`.scratchpad/coverage/new-leads/chesterfield-enumeration-controls/`:

- `manifest.json`: same-session broad and exact-model controls.
- `directory-manifest.json` and `model-directory-*.html`: all 73 directories,
  exact model IDs, source year bounds and response hashes.
- `search-manifest.json`, `search-*.html` and `search-*.json`: completed native
  searches, exact donor fields and response hashes.
- `field-report.json`: the completed saved snapshot's strict field audit.
- `bounded-166-field-report.json` and `bounded-1229-field-report.json`: preserved
  field snapshots, including the 21:50 UTC counts above.
- `newest-controls.html`, `newest-controls.json` and
  `newest-control-manifest.json`: the fresh independent 120-donor control.
- `yard-map-controls.json`: official addresses, phones and published place pins.
- `physical-yard-overlap-control.json`: all three metadata records and the
  published-directory duplicate screen.
- `overlap-controls/report.json`: the terminal 180-donor overlap sample and
  per-batch positive controls; not complete-catalog exclusivity.
- `destination-control.json`: native form behavior, stock/VIN visibility and
  the required manual destination wording.
- `application-connector-replay.json`: the terminal saved-snapshot connector
  replay, accepted source validation and all 2,111 application photo responses.
- `application-connector-partial-replay.json`: the preserved earlier partial
  replay with rejected source validation.
- `application-parser-replay.json`: saved native HTML replay with independent
  field parity and response hash verification.
- `application-photo-proof.json`: application response readback for the ten
  local sample files and the complete catalog's primary native blob identities.
- `application-client-control.json`: fresh native application-session control.
- `application-donor-replay.json`: production donor-field admission matches the
  independent audit for all 2,200 observed donors.
- `bounded-1940-field-report.json` and `bounded-1940-application-photo-proof.json`:
  the preserved 22:11 UTC subset audit before traversal completed.
- `photo-preservation/manifest.json`, `selected-donors.json`, `photos/*.jpg`
  and `preservation-proof.json`: the ten-image local preservation sample,
  exact native references, content hashes and independent offline checks.
- `photo-preservation/contact-sheet.jpg`: the visually inspected sample sheet.

The native traversal is complete. Regenerate its field report locally with:

```sh
bun .scratchpad/coverage/report-chesterfield-search.ts
```

The parser replay separately verifies the saved native HTML hashes. No new
native search is needed to reconstruct these receipts. `searches_complete`
establishes completion of the native query plan, not source acceptance or durable
photo delivery.

Recheck the saved local photo sample without source requests:

```sh
python3 .scratchpad/coverage/audit-chesterfield-photo-preservation.py --verify-only
```

The follow-up native traversal exited zero after 1,973 requests, including its
fresh bootstrap, and reached all 2,138 planned searches. Its terminal log is
`.scratchpad/coverage/chesterfield-search-full.log`. The coordination receipt is
`.scratchpad/coverage/chesterfield-search-session.json`. Session `68736` is
terminal. Preserve its completed checkpoint instead of restarting the crawl.

Next: finish the separate current live traversal and source admission. Keep
the local-only hold. The saved snapshot's photo and replay jobs are complete.

The local follow-up in tool session `59031` exited zero; do not restart it.
`.scratchpad/coverage/finish-chesterfield-local-proof.py` waits for the existing
photo manifest to report `photos_complete` with all 2,111 entries. It stops if
photo collection fails or pauses, or if its audited donor input or replay script
changes. It started no downloader. It observed photo completion, preserved the
prior partial replay receipt and ran one complete offline connector replay.

Coordination is in `.scratchpad/coverage/chesterfield-local-proof-session.json`
and `chesterfield-local-proof-tool-session.json`. The terminal replay log is
`.scratchpad/coverage/chesterfield-connector-complete-replay.log`. It delivered
2,111 photo responses, processed 2,225 observations, rejected 89 incomplete
donors and accounted for 25 repeats, with terminal accepted source validation.
The job remains `qualified: false` because current live validation is pending.
It performed no production or live Blob writes and enabled no source.

## Current live checkpoint recovery, November 12

The current live driver stopped at 02:02 UTC when a public form request hit
the unchanged 20-second timeout. Failed chunk 128 made 26 requests and accepted
no advanced checkpoint. All 127 committed chunks remained intact: 1,351
complete donors with verified application photo responses. An independent
offline review then verified all 1,351 field/photo records, 1,124 native HTML
hashes, accounting and 73 processed newest-car controls, with no errors.

One controlled bounded resume from that exact checkpoint passed at 02:06 UTC.
It freshly fetched 30 responses, added nine complete donors and committed
chunk 128 with 1,360 donors/photos at query index 899 of 2,138. The successful
resume supports an intermittent timeout; its upstream or network cause is
unknown. No timeout, parser, cursor, admission or quality guard was changed.
The sequential driver now continues from that checkpoint and stops on another
failure without an automatic retry. This is the original crawl, not a restart.

Fixed receipts are in `new-leads/chesterfield-live-current/`:
`failure-chunk-00128-timeout.json`, `timeout-chunk-00128-recovery-control.json`
and `independent-checkpoint-review-chunks-00127.json`. The failed attempt's
26 requests remain separate from committed request accounting. Its log is
`.scratchpad/coverage/chesterfield-live-current-chunk-128.log`; the successful
control is `chesterfield-timeout-resume-chunk-128.log`. The active continuation
log is `chesterfield-live-current-resumed-driver.log`, with the same current
driver-session and progress files. The three yards remain unqualified pending
terminal traversal, complete newest-control recovery and final admission.
