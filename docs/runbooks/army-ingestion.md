# Army's Auto Wrecking ingestion

Army's publishes its current self-service donor inventory at
<https://armysauto.com/self-service-inventory/>. One unfiltered HTML GET returns
the complete inline `table.bootstrap-tables`, with `data-pagination="false"`.
The inspected 2026-11-12 response contains 234 distinct native donor IDs and no
continuation. The saved connector replay accepts 231 unique donors, rejects
three (1.28%), and finds no canonical duplicates.

The connector validates the active self-service statement, native canonical URL,
physical yard identity, unfiltered make/model/year controls, native script
versions, table mode, complete document/table/row/modal structure and identity
consistency before either callback. It never infers a model year from a VIN.
The shared rejection and duplicate limits remain 10% and 25%. The configured
source minimum is 200 in the shared source policy. Admission and source
enablement are separate from this connector.

The five native columns are Images, Make, Model, Year and Color. The first cell
contains a matching donor button/modal pair, its VIN and optional stock number.
Preserve stock leading zeroes. Required identity uses `inventoryVin`, including
eligible pre-1981 manufacturer serials. Year, make and model must be meaningful.
Color and stock are optional; absent, undecodable or unusable values become
null. Photos, source inventory date and yard position are unavailable in the
initial table and remain null. The published `yswp.js` loads images from a
native detail endpoint only after a visitor opens a modal. The connector does
not require that enrichment or request donor details.

The three rejected native records remain unchanged:

| Native ID | Published year | Make/model           | Published identity |
| --------- | -------------- | -------------------- | ------------------ |
| 234       | 1988           | Chevrolet COACHMEN   | `CCR3374108371`    |
| 232       | 2002           | Dodge F40            | `F44CF7V002642`    |
| 233       | 2008           | Fleetwood Motor Home | `731DH7120861`     |

These post-1980 short identities fail the shared validator. The 1972 Cadillac
Eldorado serial `6L47S2Q422543` passes. A rejected donor with a valid identity
remains `observedVins` presence evidence. All three actual rejects have invalid
identities, so the saved replay returns no rejected valid VINs.

Army operates one physical yard at 1510 St Johns Rd, Lima, OH 45804. Native
parts phone: 567-371-1244. Native towing phone: 419-225-1896. Ten retained
stock-spread details reported `status: set`, `mark_for_resale: false` and
location Pick and Pull, corroborating the current self-service scope.

The official <https://armysauto.com/contact/> page embeds this map:
<https://maps.google.com/maps?q=armys%20auto%20wrecking%20lima%20ohio&t=m&z=10&output=embed&iwloc=near>.
Its exact HTTP 301 destination returns an embedded business tuple binding the
Army name and full street address to latitude `40.7159183`, longitude
`-84.0939616`, CID `6759621161537141604`, place ID
`ChIJwbJDIxvuPogRZHui5aH_zl0`. The same tuple confirms the towing phone and
`armysauto.com`. These are the business pin coordinates. The retained 213-yard
published baseline has no matching name, address, phone, Lima yard or yard
within 500 meters. Its nearest published yard is 90.75 km away.

Sixty stock-spread accepted native donor identities returned zero matches from
Row52 and AutoRecycler in seven retained requests. Every filtered response
honored the VIN filter and returned its positive control. This bounds the
sample overlap claim; it does not establish exhaustive catalog exclusivity.

Requests have a 20-second timeout, a bounded 4 MiB UTF-8 body, no automatic
retries and a one-minute crawl budget. Partial responses, redirects, denied
access, changed contracts and failed quality guards block reconciliation and
preserve previous inventory. Inspect the native inventory before retrying.
There are no fallback paths or alternate endpoints.

`ArmyCursor.initial` starts the single-page crawl. A complete cursor makes no
request and invokes no callbacks. `soakArmyInventory` counts and discards one
complete batch through its caller. The shared integration owns default-disabled
registration, durable scheduling, minimum count and product links.

Retained local evidence is under
`.scratchpad/coverage/parallel-mi-oh-wi/continuation/army-requalification/`:
`connector-replay.ts` and `connector-replay.json`, `identity-audit.json`,
`coordinate-provenance.json`, `physical-overlap.json`,
`physical-coordinate-overlap.json`, and `overlap-controls/report.json`.
The full inventory body is
`.scratchpad/coverage/new-leads/army-ohio-inventory-followup.html`, SHA256
`2ed97a633e30ca949bc5e2c535ba64371670274f9cfd39d7586016eeccef6974`.
The native-linked map body has SHA256
`3e63921bfd86dc8e5e72e884e2857dbfec0fe8b7d82ef99b288ef9a8d983809f`.

Run focused checks with:

```sh
bun test src/server/ingestion/army-parser.test.ts src/server/ingestion/army-transform.test.ts src/server/ingestion/army-connector.test.ts
```

When the retained local body is present, replay the actual complete connector
and soak helper without network or database writes:

```sh
bun .scratchpad/coverage/parallel-mi-oh-wi/continuation/army-requalification/connector-replay.ts
```
