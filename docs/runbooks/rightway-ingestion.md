# Rightway Auto Recycling ingestion

Status on November 11, 2026: locally qualified from saved native evidence. The
actual connector replay emitted 543 unique donors from all 543 published rows,
with zero rejections or duplicates. Shared source validation accepted this
local terminal snapshot. No production inventory was accepted or published.

## Physical yard and ownership

The official [homepage](https://rightwayautorecycling.com/) identifies Rightway
Auto Recycling as a you-pull-it yard at 7945 TN 100 W., Decaturville, TN 38329,
phone 731-549-3179. It links the vehicle inventory and says inventory changes
daily. The source represents this single yard, with location code
`decaturville`.

Coordinates 35.5290422, -88.2404327 come from the saved public ASYD business
profile with matching name, address, phone and official website. The native
homepage corroborates the physical address and links an address-based Google
embed. Its map URL does not supply explicit coordinates. No map viewport or
town center was used.

## Complete native inventory

The unfiltered [Vehicle Search](https://rightwayautorecycling.com/vehicle-search/)
response contains one `table.wpinventory_loop_all` with seven labeled columns:
Date Added, Year, Make, Model, Stock #, Color and VIN. All 543 rows and 3,801
cells match the separately saved native extraction exactly, including every
source-published donor URL. The native page describes customers checking which
parts remain available on each vehicle. These are current yard donors, without
a guarantee that a particular part remains available.

The native WordPress inventory plugin initializes DataTables without options,
using the entire inline table. No server filter form, page, offset or next-page
link appears in the saved response. The connector checks the all-inventory
table classes, exact columns, complete document/header/body/row boundaries,
native row IDs and donor links. It rejects exposed forms or pagination links
and additional inline DataTables configuration.

The native cells omit most closing `td` tags. The parser accepts only this
bounded structure, checks all seven column classes in order, and reads each
cell's own complete anchor. Every populated cell must link to its row's exact
native `inventory_id`; a repaired DOM's combined cell text is never used.
Missing optional cell values are allowed. Missing or reordered columns fail.

The connector also fetches the source-published inventory script at
`/wp-content/plugins/wp-inventory-manager/js/wpinventory.js?ver=2.5.10` and checks
its inspected SHA-256:
`3768ee331f91c20b5eb2ff1cbb9f7089a70c5cecf814ff66d71fad05073a7045`.
A changed script or version blocks reconciliation until complete enumeration
is inspected again.

## Donor fields and quality

Admission requires a valid modern VIN or eligible older serial, a four-digit
year from 1886 through 2100, and usable native make and model. The shared
`inventoryVin` contract supplies identity validation. No checksum gate, VIN
repair, decoded replacement model or inferred full year is used.

The saved catalog has 538 modern VINs and five genuine older serials:
`F14EUHJ1376` (1980), `F37YUC30264` (1975), `F10ECJD3869` (1980),
`164395A113952` (1965) and `CCD149S115732` (1979).

Color, stock and source date are optional. Genuine values are preserved, and
missing or invalid values become null. Date Added uses the native
`M/D/YYYY` calendar date, never the crawl time. Stock labels such as
`09-55-25` are identifiers rather than dates. Native multicolor descriptions
such as `Rust/White` remain usable. All 543 dates, stocks and colors survived
this replay. The source publishes no donor photos or yard positions, so
image, section, row and space are null. No generic site image is substituted.

Native donor URLs use
`https://rightwayautorecycling.com/vehicle-search/?inventory_id=<native ID>`.
Only published same-origin links with one matching ID and no credentials or
fragment are accepted. The homepage's published `/price-list/` link supplies
the source price list when present; an absent link leaves prices null.

Duplicate valid VINs, usable stocks or native donor URLs block the complete
snapshot. Rejected YMM with an independently valid VIN supplies presence
evidence only. Invalid VINs supply no presence identity. Zero admitted donors
or a rejection ratio above the existing 10% limit blocks all callbacks and
reconciliation. No shared threshold was relaxed.

## Checkpoints and recovery

One catalog checkpoint reads the homepage, unfiltered table and inspected
script, then validates the full snapshot before invoking yard or vehicle
callbacks. The cursor has strict `start` and `complete` phases; a complete
cursor is idempotent and performs no requests. The accepted page budget is
1 through 32, and a complete catalog reports one processed page.

Requests are gated at 1.6 seconds. Only complete HTTP 200 responses with the
expected HTML or JavaScript MIME and exact destination are accepted. Redirects,
partial ranges, body-length mismatches, invalid UTF-8 and oversized or
truncated bodies fail closed. Request and body reads have 20-second limits;
the catalog has a two-minute limit. A callback failure returns no advanced
checkpoint.

If any contract changes, retain the previous accepted inventory, inspect the
native site and restart from the start cursor after requalification. Do not
relax the rejection threshold, synthesize metadata or publish a partial table.

The provider-only soak helper is `scripts/soak-rightway.ts`. It runs one full
catalog through the caller's count-and-discard callback. The shared source
runner uses the `rightway` source ID; it must not publish inventory during a
local qualification.

## Saved receipts and verification

Native source evidence is under
`.scratchpad/coverage/parallel-ky-tn-ar/evidence/`:

- `asyd-native-rightwayautorecycling-com.{html,json}`: native yard identity.
- `rightway-tn-vehicles.{html,json}`: full public vehicle table.
- `rightway-tn-inventory-script.{html,json}`: inspected pagination script.
- `rightway-native-list-audit.json`: all 543 extracted native records.
- `asyd-profile-tn-rightway-auto-recycling-you-pull-it-decaturville-tn.{html,json}`:
  matching public business coordinates.
- `rightway-tn-donor-first.{html,json}` and
  `rightway-tn-donor-latest.{html,json}`: source-linked detail controls.

The required-field qualification is
`.scratchpad/coverage/parallel-sc-platforms/evidence/rightway-required-only-requalification.json`.
The actual saved connector replay is
`.scratchpad/coverage/parallel-al-ms-la/rightway-connector-replay-result.json`
with its `.log` receipt. All three input byte counts and SHA-256 hashes match
their original HTTP receipts. This replay made zero live HTTP requests and
performed no production writes.

Focused parser, transform and connector tests cover malformed and filtered
tables, optional nulls, older serials, duplicate identities, rejected presence,
the unchanged rejection limit, response boundaries and callback failures.
All 52 focused tests, changed-file lint and formatting checks passed. Repository
typecheck remained blocked by concurrent provider integration, with no
Rightway diagnostics.
