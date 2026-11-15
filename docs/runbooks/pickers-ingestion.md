# Pickers inventory

Source `pickers` covers the Texarkana, Longview and Reno Pickers yards operated by Tri-State Iron & Metal. The original Texarkana yard is at 5512 E 9th Street, Texarkana, AR 71854. Yard code is `pickers-texarkana`. Native contact is 870-772-1880. The physical location is Arkansas. Public VinPlus metadata labels its location TX; that explicit discrepancy is preserved in source scope and never copied into canonical geography.

The source is disabled by default and requires explicit rollout.

The coordinates (33.42952, -93.97398) are an exact-address ASYD business marker, corroborated by the named AutoRecycler Texarkana business within 7.402 m. Google embed viewport coordinates and AutoRecycler's repeated Longview address are excluded.

## Published source and authority

- Native inventory: `https://pickerstxk.com/Home/Inventory`.
- Native prices: `https://pickerstxk.com/Home/PartPrices`.
- Native published public app: `https://vinplus.texnrewards.com/parts/pickers-texarkana`.
- Public configuration: `https://inventory-search-api-581547763015.us-central1.run.app/api/yard-info/pickers_texarkana`.
- Public search: the same API origin's `/searchVehicleHttp` route, with operator `tri_state_iron_metal` and resolved location `pickers_texarkana` in every payload.

Native current inventory defines active stocks and the entire year/make/model tuple. Public VinPlus provides fallible VIN enrichment by exact stock association. Native photo filenames establish stock association, never VIN identity. API descriptions and native descriptions stay separate, including the 76 saved model disagreements and three native SCION/API TOYOTA disagreements. API-only stocks are quarantined for unproven active scope and retain genuine valid identities as rejected presence.

Use `inventoryVin`, including eligible pre-1981 serials. Do not infer descriptions from a VIN, impose checksum validation or repair identities. A native stock absent from every successful complete allowed API response is one required missing-enrichment rejection after all queries finish. Wrong site, contradictory stock/year, conflicting repeated whole records, truncated responses and closing drift fail the source.

## Finite traversal and transport

Bootstrap verifies native ownership, active self-service statement, the native form and literal make directory, the published public app yard-info contract and resolved configuration. Make-wide native POSTs use exact `VehicleMake` and the published empty `VehicleModel`. Derive public selectors from all nonblank literal native make/model pairs. Never send a blank or wildcard public selector. No model-menu, image, admin, analytics or private request is part of recurring ingestion.

Phases are native opening, public queries, native closing, exact first/last public bookends and terminal verification. Resume reads the native form and per-location configuration. Closing compares every native row and field, all makes and derived pairs. First/last public bookends retain whole response hashes and compare all returned fields except the derived days-in-yard counter, plus ordered entries. Final native ownership and public app guards must still agree.

Every request uses manual redirects, no retries, exact HTTP 200, expected MIME, no content-range, exact verified response URL and a complete UTF-8 body capped at 4 MiB. The same 20-second deadline covers headers and body. The production gate waits 1.6 seconds after complete body processing. Each chunk has a three-minute hard deadline and stops starting controls with fewer than 25 seconds remaining. Default data budget is 16 controls. Guard requests count toward elapsed time and cumulative cost. Total bounds are 512 requests and 32 MiB of response bytes. Capacity failures preserve prior accepted inventory and checkpoint; inspect growth or chunk sizing before restarting.

## Durable evidence and accounting

The source-local codec enforces a 1 MiB UTF-8 cap before JSON parsing and before persistence. Single-yard wire payloads omit the fixed source tag; sibling tags are rejected before restoring `pickers`. Durable registration uses `PickersCoverageCursor.parse` and `.serialize`, which preserve the source-local byte guards. A shared parser in front of these wrappers would defeat the input byte guard.

The versioned phase cursor keeps bounded whole native/API records, exact stock bindings, typed dispositions, native missing-enrichment decisions, all optional evidence, raw response hashes, ordered entry hashes, exact payload/phase/index receipts, contiguous prefix hashes and all HTTP/raw occurrence counters. Each native row also retains a hash of its complete published markup, binding every photo reference and attribute during closing checks. Compact tagged tuples retain literal optional values or unusable-value hashes, types, reasons and byte counts. Derived canonical values, presence and terminal union accounting are independently recomputed on resume. These detect corruption of trusted durable state and do not authenticate an untrusted cursor.

All nonterminal chunks return count zero, zero donor accounting, empty presence and no batch or yard callbacks. Only successful terminal closing and quality validation permit the complete canonical batch, rejected presence and yard callback. Callback failure returns no advanced cursor. Production reconciliation still requires terminal source validation: minimum 450 unique vehicles, at most 10% rejections, at most 25% duplicates and no drop below 50% of the previous accepted count.

The frozen 2026-11-12 snapshot contains:

| Measure                                                    |    Count |
| ---------------------------------------------------------- | -------: |
| Native makes / nonblank pairs                              | 34 / 197 |
| Stable native active stocks                                |      556 |
| Raw API occurrences / identical query overlaps             | 659 / 92 |
| Unique union stocks processed                              |      567 |
| Eligible native-backed vehicles                            |      540 |
| Native invalid-VIN rejects                                 |       16 |
| API-only quarantined stocks with genuine rejected presence |       11 |
| Ordinary exclusions / donor duplicates                     |    0 / 0 |

The reject ratio is 27/567, or 4.7619048%, below the unchanged 10% limit. Query overlaps are provenance, never additional donors or ordinary exclusions. Native blank-model stock STK027287 is returned by the allowed CHEVROLET/TAHOE query with an invalid VIN. It is counted once among the 16 rejects.

Eligible vehicles use native color, reference text as engine, row, calendar arrival date and actual published stock-bound image. Unusable optionals become null. Section, space, trim, transmission and parts destination are null in this snapshot. Inventory details use the native inventory page as a fallback, not a donor permalink. Every API optional remains in evidence even when it has no canonical authority. No API date or days-in-yard value overrides the native calendar date.

## Local verification and soak

`bun test src/server/ingestion/pickers-parser.test.ts src/server/ingestion/pickers-connector.test.ts` replays frozen public bodies through mocked fetch. It performs no live HTTP. `pickers-test-fixtures/saved-census.json.gz` retains the original qualification bodies, including the historical saved Focus sample. A fresh production run requests Focus again.

`scripts/soak-pickers.ts` exports a read-only chunk driver. Its caller owns staging and the request gate. It roundtrips every source-local checkpoint and rejects premature accounting or stalled progress. It does not enable the source or write inventory by itself.

Registration, source enablement and production acceptance are separate decisions. Saved-fixture success does not authorize production writes or source activation.

## Longview and Reno qualification, November 15

Both Texas yards qualify locally and join Texarkana in the durable coverage
traversal. The existing source remains disabled by default. No inventory, index
or production flag was written.

| Yard     | Native makes | Literal queries | Processed | Accepted | Rejected | Reject share | Follow-up live requests |
| -------- | -----------: | --------------: | --------: | -------: | -------: | -----------: | ----------------------: |
| Longview |           39 |             265 |       888 |      843 |       45 |        5.07% |                     208 |
| Reno     |           34 |             211 |       551 |      545 |        6 |        1.09% |                     155 |

Saved query prefixes were reused without repeating their census queries.
Each completed run includes all native makes, all literal public queries,
fresh native closing tables, and fresh first/last public query bookends.
Every live response returned HTTP 200 through the production client and gate.
The 10% rejection guard, VIN/YMM/yard guards and native whole-row closing
comparison remain in force.

`recencyAnchor` is retained as bounded optional metadata, including its observed
offset timestamp. It does not override native arrival dates. Reno stock
STK022321 has conflicting 1965/1966 serials. Its conflicting record hashes are
retained, and the stock counts once as a rejected donor with no asserted VIN.

The shared comparison for all Pickers yards ignores only `daysInYard`, a
counter derived from arrival time. Original values and raw response hashes
remain saved. Separate comparison hashes omit that counter from query
bookends; every other returned field must still agree. Tests cover daily
counter changes and failing VIN, model and color changes.

Longview exceeds 1 MiB when its complete evidence is represented as plain JSON.
The checkpoint codec compresses larger payloads with gzip, retains the 1 MiB
wire limit, and limits decoded evidence to 4 MiB. Original v1 Texarkana
checkpoints remain readable. The coverage cursor wraps one yard checkpoint
at a time and advances Texarkana, Longview, Reno.

| Yard     | Published address / phone                             | Census coordinate                 |
| -------- | ----------------------------------------------------- | --------------------------------- |
| Longview | 5910 W Marshall Ave, Longview TX 75604 / 903-459-4470 | 32.512129240164, -94.829516480918 |
| Reno     | 7090 Lamar Rd, Reno TX 75462 / 888-402-3829           | 33.663280126385, -95.454935610305 |

These Census exact-address coordinates are street-range interpolations, not
rooftop points. Longview's range is 5904-5910 W Marshall Ave; Reno's is
7090-7098 Lamar Rd. Longview's REF-before-COLOR grammar and native header typo,
and Reno's PHOTO column, retain explicit source contracts.

Evidence and admission receipts live under
`.scratchpad/provider-coverage/nov14-provider-goal/`. The
`pickers-test-fixtures/{longview,reno}-census.json.gz` fixtures retain all saved
bodies. `pickers-expansion.test.ts` replays the complete production collector,
checkpoint roundtrips, closing controls, yard transitions, exact accounting
and physical-yard inventory destinations without live HTTP.
