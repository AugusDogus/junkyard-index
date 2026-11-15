# Northwest Auto Parts qualification

Northwest Auto Parts, Anchorage AK, qualifies locally under the owner's maximum
1% unrecovered advertised-donor rule. The source is wired and disabled by default.
There are no database, index or rollout writes.

The saved complete census covers all 36 makes and 334 models: 6,934 occurrences,
6,688 accepted donors, 246 rejects (3.55%), and zero benign duplicates. Every
occurrence in the 17 conflicting VIN groups is quarantined, including 34 rows.
The 10% rejection guard and the previously selected 5,500-donor floor remain.

## Transport and traversal

The Central-style production request to ACURA MDX returned real HTTP 200 data.
The Northwest client uses the same GET profile, `Mozilla/5.0`, `Accept: text/html`,
manual redirects, combined 20-second deadline, 2 MiB response limit, and
1.6-second post-completion gate. No alternate headers or browser workaround was
needed. The earlier raw-request 403 is retained as historical evidence.

Runtime follows the published make directory, every make, and every model,
without deriving model URLs. It validates AK01 ownership, native physical address,
complete HTML, literal headings, card boundaries, VIN/YMM, inquiries and donor
links. New continuation controls fail closed for inspection. All native identity
conflicts share the existing connected quarantine rules. No inventory is emitted
until closing root, directory, every make, first/last model and every contradictory
model witnesses match. Checkpoints retain the complete native claims and validate
contiguous graph prefixes, request counts, context and hashes.

This follow-up made 17 provider requests: 14 HTML pages, one published JavaScript
resource and two native year-search AJAX calls. All returned 200. One additional
US Census request supplied an exact-address street-range match for 5700 Camelot
Drive, Anchorage AK 99504: 61.220492673939, -149.775910317066. The range is
5500-5798 Camelot Drive, not a rooftop point.

## Unrecovered donor warnings

Fresh raw model pages and their native badges confirm these saved gaps:

| Make      | Native model                              | Advertised | Found | Unrecovered |
| --------- | ----------------------------------------- | ---------: | ----: | ----------: |
| AUDI      | AUDI A4                                   |         11 |    10 |           1 |
| CHEVROLET | CHEVROLET 1500 PICKUP                     |         19 |    18 |           1 |
| CHEVROLET | CHEVROLET PASS/ (`CHEVROLET_PASS.` route) |          1 |     0 |           1 |
| CHRYSLER  | TOWN & COUNTRY                            |         21 |     0 |          21 |
| NISSAN    | TITAN                                     |         16 |    15 |           1 |
| TOYOTA    | TUNDRA                                    |        107 |   106 |           1 |
| Total     |                                           |        175 |   149 |          26 |

The exact unrecovered total is **26 / 6,934 observed = 0.374964%**, below 1%.
The 149 cars actually found within those models are not counted as missing.
Eight additional make/model-sum contradictions advertise fewer cars at make
level, so they add zero missing cars: Chevrolet 1,461 versus 1,464, Dodge 885
versus 887, Ford 1,327 versus 1,329, GMC 458 versus 461, Honda 122 versus 123,
Jeep 463 versus 465, Subaru 466 versus 468, Toyota 530 versus 531. All fourteen
contradictions remain explicit connector warnings. Future positive make deficits
are counted only beyond the already counted model deficits.

For Town & Country and Chevrolet PASS/, inspection found no donor pagination.
The donor text filter only hides already loaded cards. The native year-search
script searches individual parts, rather than filtering the donor catalog. Its
2014 Chrysler model API returns the same `TOWN_-and_COUNTRY` slug as the empty
published donor page. Chevrolet's 2014 model API offers no PASS/ alternate.
No additional donor route was found and no donor identity was inferred from a
part search. All responses and the native script are saved.

## Offline verification and evidence

`northwest-expansion.test.ts` traverses all 334 models through the real client,
serializes each checkpoint, and verifies 418 replay requests, terminal counts,
Census geography, disabled rollout and destinations. It tests the 1% boundary,
missing models, changed checkpoints, new continuation, wrong supplier, truncation
and HTTP refusals without emissions.

The complete historical census consists of **browser DOM observations**, not raw
HTTP captures. The fixture retains original row HTML, literal links and inquiry
claims, with reconstructed document/card envelopes explicitly identified in the
test. Fourteen current real HTTP HTML witnesses independently exercise the raw
parser and request profile. This qualification does not claim a new live
334-model census.

- Original census and closing evidence:
  `.scratchpad/coverage/parent-refills-nov14y/northwest_continue/`.
- Current HTTP, native JavaScript, AJAX and Census evidence:
  `.scratchpad/provider-coverage/nov14-provider-goal/northwest-expansion/`.
- Offline fixture: `src/server/ingestion/northwest-test-fixtures/qualified-census.json.gz`.
- Admission: `.scratchpad/provider-coverage/nov14-provider-goal/northwest-anchorage-local-admission.json`.

Run `bun test --timeout 15000 src/server/ingestion/northwest-*.test.ts` offline.
An authorized read-only soak is available through `soak:sources -- --sources=northwest`.
