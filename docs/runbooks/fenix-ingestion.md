# Fenix U-Pull ingestion

See the current [source flags and census floors](provider-coverage-go-live.md).

The connector covers Elmira, Binghamton and East Syracuse in New York, plus Moultrie, Georgia. It uses native `fnx_location` preferences 1, 2, 3 and 4 on `https://fenixupull.com/recent-inventory/`. Obsolete Belleville remains outside scope.

## Moultrie qualification, November 15

The exact production profile (`JunkyardIndex/1.0`, `Accept: text/html`, location cookie 4, redirect error and the 1.6-second gate) returned real HTTP 200 inventory. No header workaround was needed. The historical raw-browser 403 remains saved as evidence of that earlier request, not the current transport result.

All 24 pages in both date orders and four fresh bookends passed: 1,168 distinct donors, 1,152 accepted and 16 rejected (1.37%). The follow-up used 52 provider GETs and one Census lookup. Full four-yard runtime replay is `fenix-expansion.test.ts`, using saved raw responses only. The legacy native `/inventory/STK000524` route is accepted only when its stock ownership matches.

The published address is 232 Industrial Road, Moultrie GA 31768. Census matches the street, number, city and state but returns ZIP 31788. Its street-range coordinate is 31.186237400954, -83.734815292513. This postal discrepancy is preserved, and the native map view center is separate evidence.

Admission: `.scratchpad/provider-coverage/nov14-provider-goal/fenix-moultrie-local-admission.json`. New captures: `fenix-expansion/production-opening.{html,json}`, `qualified-census.json` and the Census receipt. Existing source rollout remains unchanged.

The native page explicitly describes its full current yard inventory. The ten-column table supplies native VIN or older serial, year, make, model, yard, detail destination, and optional placement metadata. A valid native detail link is required. Optional color, stock, photo, date, and yard position never cause a missing-field rejection. Genuine optional values are preserved; unusable values become null. Photos retain the exact native donor-bound thumbnail URL, without fetching bytes or inventing larger images. Missing, unsafe, unrelated-owner, and placeholder image references become null. A source row explicitly marked held, sold, crushed, removed, or inactive fails active-donor admission.

The shared `inventoryVin` validator accepts standard 17-character identities without a checksum gate and genuine five-to-sixteen-character older serials paired with a full pre-1981 year. A donor rejected for YMM still supplies independent valid VIN presence. Different native detail owners cannot reuse an eligible identity, including across yards or rejected records.

## Completeness and checkpoints

Date ties repeat source identities across page boundaries, so one sort order is insufficient. The connector traverses both published `date_placed DESC` and `ASC` orders, follows the published page capacities, and stops at `>>`. The native `>` link still points past the terminal page and is never followed there. The opposite-sort header keeps the current page number; page one establishes the alternate traversal entry.

Completion requires the distinct native-detail union to equal both complete traversals' raw capacities. Overlapping objects must have identical descriptions and owners. Each order retains its own 25% duplicate guard. Alternate-order overlap is recorded as intentional exclusion, while actual within-order repeats remain duplicates. Each yard must independently retain at least one accepted donor and no more than 10% rejected donors. Shared source minimum and previous-run drift checks also apply.

The cursor retains raw donor identity evidence, ordered page IDs and hashes, verified-yard prefixes, and all four completion bookend checks per yard. Resume rechecks the active order's head and last processed page. Completion rechecks the head and terminal page in both orders. Serialized checkpoints validate every page hash against retained rows, ownership, exact page prefixes, and completed-yard quality. HTTP, metadata, ownership, drift, callback, and validation failures return no advanced checkpoint. Previously published inventory remains intact.

HTTP requests require unredirected status 200, complete UTF-8 HTML, correct MIME and native destination. Requests are gated, bounded to 3-32 per chunk, and normally spaced by 1.6 seconds. There are no automatic retries. New sources run by default; serving false from a source flag pauses it.

## Physical location evidence

Addresses, phones and yard-specific websites come from native location cards. Canonical coordinates for Elmira and Binghamton come from exact-address ARA business listings, independently matched to native addresses and owner. Their native Google Maps `ll` values are map view centers and remain separate validation evidence. East Syracuse supplies an explicit native business pin.

| Yard          | Native address                           | Canonical business coordinates | Provenance                                       |
| ------------- | ---------------------------------------- | ------------------------------ | ------------------------------------------------ |
| Elmira        | 1592 Sears Road, Elmira, NY 14903        | 42.156052, -76.8627312         | ARA member 2977, Horseheads Automotive Recycling |
| Binghamton    | 230 Colesville Rd, Binghamton, NY 13904  | 42.1094648, -75.8217977        | ARA member 2975, Garys U-Pull U-Save             |
| East Syracuse | 7030 Myers Road, East Syracuse, NY 13057 | 43.094055, -76.037907          | Native directions `!3d43.094055!4d-76.037907`    |

The nearby Fenix Parts address at 216 Colesville Rd is a different facility. Do not merge it with this Binghamton yard. Saved ARA provenance is `.scratchpad/coverage/parallel-ny-nj-de/d069f2a57bd174fa2f64.{body,json}`, SHA-256 `0e48161efd8f1612cb723e584df0cdc7ceaecf933d6bce7a74cc40699d67c2b0`.

## Qualification and verification

The 2026-11-12 native capture contains 200 verified GET receipts, including 190 traversal pages, head checks and donor controls. The source inventory update label was 11/10/2026.

| Yard          | Census | Accepted | Rejected | Rejected share |
| ------------- | -----: | -------: | -------: | -------------: |
| Elmira        |  1,144 |    1,136 |        8 |          0.70% |
| Binghamton    |  2,011 |    2,001 |       10 |          0.50% |
| East Syracuse |  1,524 |    1,458 |       66 |          4.33% |
| Total         |  4,679 |    4,595 |       84 |          1.80% |

All rejected source identities were invalid; no eligible rejected identities appeared in this capture. Twelve accepted donors use eligible older serials. There were no different-owner eligible identity collisions.

Saved source proof: `.scratchpad/coverage/parallel-ak-hi/evidence/fenix-ny-requalification.json`. The actual connector replay verifies all 200 response hashes, uses only saved native HTML through the request gate, and serializes every checkpoint:

```sh
bun test src/server/ingestion/fenix-*.test.ts
bun .scratchpad/coverage/parallel-ak-hi/helpers/replay_fenix.ts
```

Terminal replay evidence: `.scratchpad/coverage/parallel-ak-hi/evidence/fenix-connector-terminal-replay.json`. It records 4,595 unique emissions, 84 rejections, 326 actual within-order repeats, 4,353 intentional alternate-order exclusions, 15 serialized checkpoints and 228 gated replay requests. Live HTTP and production writes are both zero.

For an authorized fresh read-only soak, use `bun run soak:sources -- --sources=fenix --max-pages=1000`. It counts and discards vehicles without database, index or blob writes. Do not rerun a saved qualification crawl merely to reproduce the offline proof.

Preserve the source disclaimer: placement dates may reflect photo or inventory updates, and customers remove or purchase parts daily. A listed donor or photo does not establish individual part availability.
