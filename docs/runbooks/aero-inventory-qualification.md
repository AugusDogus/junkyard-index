# Aero Auto Salvage inventory qualification

See the current [source flags and census floors](provider-coverage-go-live.md).

Status on November 11, 2026: locally qualified and unpublished. A
saved-evidence replay through the revised connector emitted 135 donors from
141 native rows and passed shared source validation. Six invalid or
inconsistent identities were rejected. No production snapshot was accepted or
published.

## Yard identity

The official [homepage](https://aeroautosalvage.com/) identifies Aero Auto Parts
LLC at 707 Aero Drive, Shreveport LA 71107, phone 318-227-1010. It explicitly
states that this standalone location is not affiliated with UAPI. Former names
include KM's U-Pull-It and Aero Auto Salvage, Inc.; those names do not establish
additional yards.

The official [directions page](https://aeroautosalvage.com/directions/) links a
business map pin at 32.528713, -93.7699419. A separately linked street-address
pin is within two meters. The map URL's initial viewport is elsewhere and must
not be used as the yard location.

The [yard map](https://aeroautosalvage.com/yard-map/) describes physical numbered
rows, including the relationship between rows 3, 13, 23 and 33. None of the
three published Louisiana baseline addresses matches this Shreveport location.

## Native catalog and field audit

The official [vehicle inventory](https://aeroautosalvage.com/vehicle-inventory/)
returned HTTP 200 with an update label of November 11, 2026. Its complete
server-rendered table contains 141 rows. DataTables performs pagination in the
browser; the inspected initialization declares no server-side or Ajax page
source. This establishes enumeration of the published table, not an independent
total of every vehicle physically in the yard.

Each row has labeled year, make, model, engine, color, VIN, stock, row and
arrival-date cells. Photo links are published in the same stock's row.
The homepage's separate seven-day arrival table contains 23 stocks, all found
in the 141-row inventory table.

The initial stricter field screen found:

- 131 records with required fields and a published stock-matched photo link.
- Five malformed modern VINs, two absent or unknown colors, and three records
  with no stock-matched photo link. These ten records are distinct.
- No duplicate VIN/serial or stock in the table.
- No missing stock, row or source arrival date in this observed table.

The current admission contract requires usable VIN/older serial and year, make
and model at the verified yard. Color, stock, photo, arrival date and row are
optional. Preserve valid native values; absent or invalid values become null.
Do not repair truncated VINs, infer stock from image filenames, invent arrival
dates or replace missing photos with `/inventoryphotos/default.png`.

Known colors retain canonical normalization. Stock must match `STK` followed
by six digits, row must be a positive integer label, and dates must be genuine
calendar dates in the native `MM/DD/YY` format. Photos must be published links
in the donor's row, use the official origin and native inventory-photo path,
and contain no credentials, query or fragment. When valid stock is present,
the photo filename must match it. A published valid photo may remain usable
when stock is absent, without filling the stock field from its filename.

Stock `STK007105`, VIN `5UXFE43588L007670`, is published as a 2008 BMW
`BELAIR`. Treat that make/model combination as unresolved source data and
exclude it from any proposed admission set until verified. Do not infer a
replacement model from its VIN or photo. Alongside the five malformed modern
VINs, it remains one of six rejected rows. The two unknown colors and three
missing photos no longer reject otherwise usable donors.

## Photos and overlap

All 131 initially selected photo URLs returned HTTP 200 without redirects.
Each response was an image, passed image decoding and had a distinct SHA-256
hash. Every selected URL was taken from a stock-matched native link, without
constructing a filename. The selected photos contain no expiry query strings.

Three stock-spread controls were visually checked as actual donor photographs:
`STK004808`, `STK007034` and `STK007112`. This verifies those three images
visually, not all 131. The middle and final controls are donor interior views.

All 131 initially field-complete VINs matched neither Row52's public active
inventory nor AutoRecycler's exact-VIN search. Both queries recovered their
separate positive controls. This includes the unresolved BMW record and does
not establish exclusivity for all possible historical or rejected records.

## Local connector qualification

The connector fetches the official homepage, directions and complete inventory
with a 1.6-second request gate. One catalog checkpoint covers these three HTTP
requests. The original live read completed in 4.7 seconds. The revised
connector replay used the complete saved HTML for those three endpoints,
recovering all 23 homepage arrival controls with matching descriptive fields.
It made no live HTTP requests, emitted 135 unique donors, rejected six of 141
rows (4.3%), and reported zero duplicate identities or missing required
identities. Its nullable metadata counts are two colors and three photos;
all emitted stock, row and arrival dates remain valid in this saved snapshot.
The rejected BMW's valid VIN is retained as presence evidence. The five
malformed modern VINs supply no presence identity.

The unresolved BMW `BELAIR` combination is rejected explicitly. No replacement
model is inferred. The earlier live photo and aggregator-overlap audits retain
their original 131-record scope. They cover the original 130 admitted donors
and the rejected BMW, not the five newly admitted donors. Two of those five
have native photos outside the earlier HTTP/image audit; the other three have
null photos. The saved replay makes no new external overlap claim.

The source minimum is 43 donors. The existing rejection limit (10%),
previous-count drift limit (50%) and duplicate limit (25%) are unchanged.
Shared validation accepted this local terminal snapshot. This is not production
enablement or reconciliation.

Before invoking either callback, the connector verifies official yard identity,
complete table structure, unique valid stock/VIN identities, the inspected
inline DataTables initialization, required identities, arrival controls and
rejection quality. Missing or invalid optional stock is not an identity.
Homepage controls must each recover a separate matching catalog row, including
when multiple controls omit stock. Duplicate valid homepage stocks still fail.
Only photo cells may omit HTML end tags, matching the native source.
Partial HTTP responses, changed pagination, redirects, unexpected MIME, body
length mismatches and truncated pages fail closed. Requests and body reads have
20-second limits; the complete operation has a two-minute limit.

The inventory page exposes a searchable inline table without per-donor links.
Search cards, email and Discord therefore use the existing manual-search
action: **Search provider inventory**, followed by instructions to search the
table and match VIN and stock. Tests verify this labeling across those surfaces.
No claim is made that the bare link automatically opens a matching donor.

`ingestion-source-aero` pauses ingestion only when it serves false. Missing,
unreadable or malformed flags keep the source enabled. Qualification remained
local and unpublished. Louisiana's published count stays three. Aero is one additional
locally qualified yard alongside the four RTP/Nevada yards.

Validation for the revised contract: 63 focused Aero tests, changed-file
TypeScript lint, formatting and `git diff --check` passed. Repository typecheck
did not pass during concurrent provider edits; it reported no Aero errors.
The earlier full-suite receipt passed 1,316 tests before this contract change.
The provider-only soak command is
`bun run soak:sources -- --sources=aero --max-pages=1`; it counts and discards
batches without publishing inventory.

On a changed table or failed quality check, retain the previous accepted
inventory, inspect the native site and rerun from the start checkpoint. Do not
relax the thresholds or synthesize fields. Any rollout remains outside the
current local-only authorization.

## Local receipts

Saved under `.scratchpad/coverage/new-leads/`:

- `aero-inventory.html` and `aero-field-audit.json`.
- `aero-root.html`, `aero-directions.html`, `aero-identity-controls.json` and
  `aero-map-controls.json`.
- `aero-photo-audit.json`, with 131 response/hash/image checks.
- `aero-photo-control-receipt.json` and three saved visual controls.
- `aero-overlap-report.json`, with both positive controls and no matches.

The overlap execution receipt is `.scratchpad/coverage/aero-overlap.log`.
All inventory batches and evidence remain local.
The fresh connector receipt and full local donor snapshot are
`.scratchpad/coverage/aero-live-connector.log` and
`.scratchpad/coverage/aero-live-connector-result.json`.
The revised saved-evidence receipt and 135-donor snapshot are
`.scratchpad/coverage/parallel-al-ms-la/aero-nullable-replay.log` and
`.scratchpad/coverage/parallel-al-ms-la/aero-nullable-replay-result.json`.
The replay records SHA-256 hashes and byte lengths for all three saved inputs.
