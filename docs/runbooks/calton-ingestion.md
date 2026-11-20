# Calton ingestion

See the current [source flags and census floors](provider-coverage-go-live.md).

Calton Auto Parts Recyclers is the native MM28 supplier at 7491 Washington
Blvd, Elkridge MD 21075, phone 410-799-1320. The verified business point is
39.1794853, -76.7697906. Its native footer spells the city "Eldridge"; that typo
is retained in evidence. The physical screen found no matching accepted yard
or location within 250 metres.

The source runs unless its pause flag serves false. Qualification did not
deploy the application, change production flags or publish inventory.

## Native inventory contract

The connector reads homepage arrivals, the published `/parts/` make directory,
every literal make menu and every literal model control. The November 13 capture
contains 47 makes, 630 model controls and 679 complete source documents.
Its 12,879 model appearances and nine arrivals form one source union. One
arrival is absent from the captured model pages and remains included.

Every document must retain native ownership, its canonical source, complete
markup and understood donor boundaries. Unread continuation controls block
completion. The observed photograph carousels and Elementor slides widget are
classified separately from inventory pagination. Menu badges remain diagnostics:
35 count discrepancies and the explicit dotted `CHEVROLET_PASS.` no-results
response are preserved. No atomic provider-wide snapshot is claimed.

Model pages follow the shared
[incremental model census](model-census.md): its read reasons, gap full reads,
replay floor, outage path and seeding rules apply here. Every run reads the
homepage arrivals, the make directory and every make menu. A model is also read
when a homepage arrival's donor destination binds to it but its carried page
lacks that destination. A missed, failed or rejected run makes the next run read
every model page. The census contract is
`calton/literal-model-graph/root-arrivals-union/incremental-model-census-v3`.

Calton has no closing pass, so no short page is ever confirmed. A model page
read below its expected cards (its badge plus any surplus its last accepted page
listed) is read again on the next run instead of being carried. In the November
13 capture, 22 models list one row above their badge, and that surplus counts
toward their expected cards.

Before the snapshot, read and carried model cards, each model capped at its own
badge, must cover at least 95% of today's model badges
(`CALTON_MINIMUM_BADGE_COVERAGE`). The shared 97% replay floor also applies to
every model with a last accepted page, lowered by any count drop. The November
13 capture covers 12,856 of 12,857 badge cards; only the native-empty
`CHEVROLET_PASS.` is short. Emptying one sweep slice leaves 78.6% to 87.9% of
badges. Cutting one slice to a single card per model leaves 79.4% to 88.8% of
badges and of the 12,879 accepted cards (the lightest slice, 111 models and
1,554 cards, keeps 11,413 of 12,857 badges and 11,435 of 12,879 cards). Either
fault fails both floors on its first run and publishes nothing.

A cold census, or the full read after a missed, failed or rejected run, makes
about 679 requests (the November 13 graph). A steady day makes the 49 fixed
requests (homepage, make directory and 47 make menus) plus about a sixth of the
630 model pages and any new, recounted, triggered or short ones.

Required VIN or supported historical serial, year, make, model and owned donor
destination come from native claims. No VIN decoder fills or changes identity.
Eight literal serials from 1972 through 1980 follow the existing `inventoryVin`
contract. Color, stock, photographs, inventory dates and position are optional.
One usable optional value survives duplicate appearances; disagreeing usable
values become null.

Two source menus and their donor links use different native ampersand slugs:

| Menu path                              | Donor parent path                      |
| -------------------------------------- | -------------------------------------- |
| `/parts/CHRYSLER/TOWN_-and_COUNTRY`    | `/parts/CHRYSLER/TOWN_and__COUNTRY`    |
| `/parts/LINCOLN/LINCOLN_-and_TOWN_CAR` | `/parts/LINCOLN/LINCOLN_and__TOWN_CAR` |

Only these observed aliases are accepted. Native title, make, year, VIN and
stock consistency still apply. Both literal URLs are retained. Percent encoding
is decoded only when comparing a stock segment with its native stock value.

All appearances are assessed before deduplication or canonical make display.
Conflicting VIN or donor-destination groups quarantine every connected
appearance. There is no first-row winner or stock-only deduplication.

The independently reconciled union is 12,549 accepted donors, 331 rejected
appearances and eight benign duplicate appearances, totaling 12,888. Rejections
include 317 required-field failures and 14 appearances in seven conflicting
identity groups. Fifteen rejected valid VINs are preserved for reconciliation.

## Checkpoints and recovery

Eight native requests form a durable chunk. Nothing is emitted until the entire
graph is read and the source minimum of 4,183 passes alongside the unchanged
10% rejection, 25% duplicate and 50% previous-run retention guards. A complete
cursor is published only after the caller accepts the terminal batch.

Requests are serialized with a 1.6-second pacing interval. Each request/body
lifetime is limited to 20 seconds and 2 MiB, with no automatic retry or redirect.
The graph is bounded at 2,048 requests and 256 MiB; serialized cursor input is
bounded at 64 MiB (`CALTON_MAX_CURSOR_BYTES`). In the historical full-read
replay, before the incremental census, saved nonterminal checkpoints reached
14,043,927 bytes and the complete pre-emission ready state was 14,104,437
bytes. A checkpoint now also carries the previous census; the code estimates
that state at about 27 MB for 12.9k rows.

After an HTTP, parser, continuation, cursor or quality failure, preserve prior
inventory and inspect the exact saved failure. Resume only the last validated
checkpoint after resolving the cause. Do not invent alternate model URLs or
accept partial response bodies. The original capture's Nissan timeout and
partial Avalon body remain separate from their complete authorized recoveries.
The obsolete `/inventory/` DNS failure and recovered 404 are also retained.

## Evidence and verification

- Capture: `.scratchpad/coverage/parallel-pa-md-wv/maps-native-frontier53/final-source-manifest.json`.
- Independent reference, including historical serials: `.scratchpad/coverage/parallel-al-ms-la/calton-reference77-legacy01/`.
- Serialized connector replay: `.scratchpad/coverage/calton-ut51-corrected-terminal-replay/`.
- Shared dispatcher and memory-only persistence proof: `.scratchpad/coverage/parent-calton-local01/`.
- Independent implementation review: `.scratchpad/coverage/parallel-ky-tn-ar/calton-final-review42/`.

Focused checks cover native parsing, cross-page conflict quarantine, rejected
VIN preservation, literal route aliases, bounded HTTP, cursor integrity,
continuations, no early emission, callback failures, terminal source validation
and pause-only flags. Run `bun test src/server/ingestion/calton-*.test.ts`
and the shared durable-source and source-validation tests after changes.

The parent replay checked all 679 saved response bodies through the shared
dispatcher and 85 serialized checkpoints. All 25 canonical fields match the
independent 12,549-donor reference at emission, snapshot and persistence.
Validation and reconciliation pass in memory. Fifteen artificial rejected-VIN
seeds retain their prior metadata, an absent seed retires, and the native source
replaces an AutoRecycler mirror while retaining its first-seen date. Seed rows
are excluded from accepted inventory counts.

That proof caught a missing Calton reconciliation priority. The correction
explicitly places Calton before AutoRecycler. New regressions check complete,
unique source-priority registration and native mirror takeover. The full suite
passed 3,440 tests before that correction; all 20 affected reconciliation tests,
lint, typecheck and formatting pass afterward. The unchanged full replay then
passed with the correction. Logs and the terminal receipt are retained in
`.scratchpad/coverage/parent-calton-local01/`.

Saved-response replay and memory-only persistence do not establish hosted
Turso HTTP or Workflow payload capacity. Large checkpoints travel through
shared SQL and workflow boundaries; validate those limits before any rollout.
Remote Blob storage and production deployment are untested.
