# Utah Pic-A-Part qualification

See the current [source flags and census floors](provider-coverage-go-live.md).

Two additional Utah yards are locally qualified and unpublished.
The user's local-only instruction remains in force. Do not push, deploy, enable
this source or write inventory/photos to production.

| Yard          | Native rows | Accepted donors |   Rejected |
| ------------- | ----------: | --------------: | ---------: |
| Ogden, `1064` |         979 |             959 | 20 (2.04%) |
| Orem, `1065`  |         768 |             768 |  0 (0.00%) |

The unchanged per-yard rejection limit is 10%. VIN or supported older serial,
year/make/model, physical ownership, active availability and complete enumeration
remain required. Color, stock, photo, inventory date and yard position follow the
existing nullable canonical contract. Independently valid VINs from rejected
records supply presence evidence only.

## Source and identity

Official [Ogden](https://utpap.com/ogden-inventory/) and
[Orem](https://utpap.com/orem-inventory/) pages publish native PHP make searches.
Their premium pages link JavaScript that fetches the complete public
`1064_inventory.xml` and `1065_inventory.xml` feeds. Premium inventory filters
these same feeds and is not a separate yard.

All 1,747 saved native XML stocks match all 82 PHP make searches exactly on stock,
year, make, model, row and set date. The feeds publish VIN or supported older
serial, `iSTATUS=0` and `LOCATION=YARD`. Stock remains this provider's required
native join key because the PHP control has no VIN. Valid source stock values are
preserved. Missing or invalid optional metadata becomes null; conflicting optional
row/date controls become null without weakening required stock/YMM/yard parity.
No third-party enrichment is required.

Official contact pages and linked business pins establish these distinct sites:

- Ogden: 555 W. 17th Street, Ogden UT 84404, 801-612-6446,
  41.2364008 / -111.9913269. Its page body conflicts on ZIP; the official footer
  and matching named business pin use 84404.
- Orem: 255 S. Geneva Road, Orem UT 84058, 801-756-5878,
  40.2926496 / -111.7331302.

The five published Utah yards have different addresses and coordinates. These
two would move Utah from five to seven after a separately authorized rollout.

## Terminal local proof

The required-field application connector replay finished in
58 chunks, 1,747 processed, 1,727 emitted, 20 rejected, zero duplicates, an
explicit complete cursor and accepted source validation. Every archived
checkpoint round-trips through the actual durable serializer/parser.

There are 73 donors with null color and 29 with null photos. All 1,698 supplied
valid donor images decoded, were preserved by content hash, passed independent
local storage readback and were served through the application photo response
with the same hash. Rejected records comprise three malformed modern VINs and
17 category-valued makes. No emitted VIN or preserved photo hash is duplicated
within or across the yards.

Absent, placeholder, malformed, ambiguous or mismatched optional photo references
become null without a photo request. A valid stock-bound photo URL still requires
successful preservation. HTTP failures, invalid response bodies and storage errors
abort the chunk without returning an advanced checkpoint or accepting reconciliation.

Original XML capture was 02:29:48Z, photos were captured at 02:31:56-02:35:56Z
with two earlier controls reused, and bounded XML rereads at 02:57:27Z were
byte-identical. After the nullable-field policy change, 59 previously uncaptured
stock-specific JPEGs were read once at 05:12:20-05:13:53Z, with the normal
1,600 ms source gate and no retries. This is time-separated public evidence,
not an atomic snapshot or a production storage/delivery check.

Independent reviews verified all source joins, all emitted canonical records,
all 58 checkpoints, image decoding and rejection accounting. Resume controls
accept exactly 10% rejection and fail above it. Resume photo accounting includes
emitted donors without images while retaining exact preserved-hash accounting.
Version 2 checkpoints reject the previous required-metadata policy's checkpoints;
restart this unpublished source from its initial cursor after the policy change.
The source runs unless its pause flag serves false, requires 575 unique donors, and retains
existing drift and duplicate guards.

## Operation and evidence

`utpap` uses bounded JSON checkpoints for yard discovery, make enumeration and
photo preservation. Its production adapter uses the existing private photo
store; the local soak uses memory only. Failures return no advanced checkpoint
and preserve previously published inventory. Inspect the source before retrying
the last validated checkpoint. No automatic provider retry is configured.

Vehicle links use the yard's native PHP make search and the exact source make
token, labeled **View matching inventory**. Match the stock number there.
The PHP table does not visibly show VIN.

Receipts under `.scratchpad/coverage/parallel-ut-co-ok/`:

- `report.json`, `utpap-offline-replay.json`, `utpap-qualified-vehicles.json`.
- `utpap-freshness-comparison.json`, `utpap-photo-audit.json` and archived cursors.
- Independent source/application reviews in `parallel-wa-or-id/`, and photo
  review in `parallel-mi-oh-wi/utpap-photo-review.json`.

Required-field replay outputs and all archived checkpoints are under
`.scratchpad/coverage/parallel-ma-ct-ri/assist-sc/utpap-new-policy-replay/`.
The additional photo provenance and hashes are in
`../utpap-new-policy-photos/capture-receipts.json` relative to that directory.

The connector has 44 focused tests. Current policy checks are recorded under
`.scratchpad/coverage/parallel-ma-ct-ri/assist-sc/utpap-new-policy-*.log`.
The earlier affected application checks and full suite are recorded in
`.scratchpad/coverage/utpap-*.log`. A valid source proof does not authorize
production publication or enablement.
