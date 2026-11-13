# A Plus Auto LLC

Local source `aplus`, yard `nicholasville`, supplier `QQ91`. Source implementation
and verification use saved public captures. Shared registration and admission are
owned by the parent workflow. No production writes or enablement are implied.

## Published scope

The finite known source is every literal make/model link published under
`https://aplusauto.parts/parts/makes/`, unioned with native
`/latest-arrivals/` cards. The homepage has a different arrival presentation and
is used only for official ownership verification. Native model copy includes
vehicles awaiting part-out. The graph and badges do not establish an unseen
backend census or an atomic inventory snapshot.

The November 12, 2026 capture has 35 makes, 232 model controls and 1,226 native
model donor observations. Opening arrivals contain 42 cards and closing arrivals
contain 43. Their temporal required-identity union contains 43 observations.
The complete union has 1,269 observations: 1,222 accepted unique donors,
37 benign duplicate observations and 10 rejected occurrences across five
conflicting VIN groups. Required rejection is 0.7880%; duplication is 2.9157%.
All occurrences of native Nissan/Datsun versus Nissan, Mercedes-Benz versus
Mercedes, and Mercedes GL versus GLC conflicts are quarantined before canonical
make normalization. Their five valid VINs remain independent presence evidence.
No alias or preferred winner repairs a conflict.

Toyota 86 publishes badge 1 but explicitly returns no results. Its native h1
`Used toyota 86 Parts` binds case-insensitively to the published control. GMC
make badge 10 differs from its model badge sum 11. Badges remain diagnostics and
never remove observations or supply quality denominators.

The arrival-only Lexus stock 2856 supplies native 2024 LEXUS RX350 and VIN
`2T2BBMCAXRC032032`. Its exact native donor destination independently confirms
that identity and supplier ownership. Its component pagination stays within the
same donor and was not followed. The runtime does not fetch donor details or
invent a browse route from an arrival-only destination.

## Yard provenance

Official native pages identify A Plus Auto LLC at 2125 Catnip Hill Rd,
Nicholasville, KY 40356. Canonical native header phone is 859-710-6294; native
footer/URG alternate is 859-421-3043. No genuine unprotected email is supplied.
Website is `https://aplusauto.parts/`.

The qualified named-business Google/ASYD point is 37.9340629, -84.559118,
with accuracy unstated. The separate native address-feature map point
37.9352107, -84.5586449 is retained as evidence. External Maps phone
859-222-7028 is a separate observation. No tracking bridge or phone equality
is inferred. Physical qualification found no overlap with 261 accepted yards.
The excluded Lexington listing receives neither this census nor a second yard.

## Runtime contract

The connector reads official homepage ownership, latest arrivals, the make
directory, every literal make and every literal model. Only owned HTTPS browse
URLs are allowed. It never fetches donor details, images, parts searches or
inferred routes. All supplier declarations must agree on `QQ91`. Complete
HTML, native owner, physical address and a recognized native phone are checked.
Phone equality across surfaces is not required. HTTP must be complete,
unredirected 200 text/html. Failures receive no automatic retry.

Closing controls repeat ownership, the make directory, every make directory,
the first and last model, models with badge/card discrepancies, and published
models missing an opening arrival VIN. Final arrivals join the temporal union.
Changed closing graph/list fingerprints stop emission. These controls do not
claim simultaneous stability of every unrefetched model page. Explicit empty
pages must bind their native h1 and lack donor continuation.

Chunks perform at most eight serial GETs under a three-minute deadline.
Each request and complete body share a 20-second deadline. Transport waits
1.6 seconds after body consumption on success and failure, including across
chunks. Runs stop at 1,024 GETs. Bounds are 2 MiB HTML, 1 MiB cursor,
64 makes, 512 models, 128 models per make, 1,000 cards per page and
10,000 raw model rows. Exceeding a bound preserves prior inventory.

`AplusCursor.initial`, `.parse` and `.serialize` hold a strict source-tagged,
checksummed contiguous traversal prefix. The wire bound applies before JSON
decoding. Cursors contain native tuples, controls and fingerprints, without
HTML or canonical vehicle arrays. Checksums detect corruption, not tampering.

Native VIN or supported older serial, year, make/model, owned destination and
verified yard identity are required. Required fields never come from VIN
inference. Native menu make context delimits the supplied Make/Model label.
For arrival aliases absent from the menu, the pinned provider `formatPartURL`
substitutions delimit only an exact match to the entire supplied label.
Missing or contradictory native YMM cannot be repaired from route tokens.
Same-card inquiry contradictions stop the source before callbacks.

Stock, image, date, color and yard position are optional. Missing, unusable,
repeated or contradictory optional values become null without rejecting the
donor. A stock that contradicts the native destination becomes null. Dates must
be genuine calendar dates. Only the primary card image is metadata; hidden
galleries are separate photographs. Images must bind usable native stock under
the QQ91 CloudFront prefix. Conflicting supplied optional values across accepted
observations become null, including temporal arrival disagreements.

All required VIN/YMM conflicts and destination collisions are classified before
callbacks. Paused chunks emit no inventory, accounting or VIN presence.
Completion supplies disjoint accounting and valid rejected VIN presence.
Callback failure supplies no completed checkpoint. The source floor is 1,000
accepted donors. Existing 10% rejection, 25% duplicate and downstream 50% drift
guards apply.

## Evidence and verification

Native graph and census are in
`.scratchpad/coverage/parallel-ky-tn-ar/aplus-remaining-make-graph03/` and
`aplus-unread-model-census04/`. Historical source closure and its frozen oracle are in
`aplus-native-closure05/`. That historical oracle SHA-256 is
`805f33e913cc5b7b8bce14170be8dfd3acff33049616c399e4499519764e7ddc`.
Physical identity is sealed in
`parallel-az-nm-nv/aplus-physical261-qualification01/qualified-yard-identity.json`.

The frozen oracle has an acknowledged optional-image extraction defect: some
model card enclosing donor anchors were recorded as images. That artifact stays
unchanged. Application images are parsed from primary `img[data-src]` metadata
and verified separately against saved native markup.

Current qualification uses the independently corrected native oracle in
`parallel-ky-tn-ar/aplus-corrected-independent-oracle08/strict-native-candidate-oracle.json`,
SHA-256 `19aba851d203705a4c5118201bd9f94e3a1f1a0554ca45d2bab2cd7c40bafa1f`.
It corrects optional images while preserving all 1,222 accepted identities and
the five quarantined VINs. The final local application proof is
`.scratchpad/coverage/parent-aplus-final11/replay-report.json`. It compares all
25 canonical fields in emitted output, stored snapshots and persisted rows,
preserves prior metadata for five rejected VINs, retires one absent seed and
verifies the single yard. Its 1,227 live proof rows include those five preserved
seeds; only 1,222 count as newly accepted donors. No production storage is used.

Source replay evidence is
`parallel-mt-wy-nd/aplus-application01/offline-replay-report.json`. Real parser,
cursor, connector and soak code read 270 pinned opening bodies, with four
fresh captured closing overrides. Other mocked closing controls reuse their
opening captures. Replay performs 312 mocked GETs across 39 serialized chunks,
peaks at a 179,828-byte checkpoint, and emits only at terminal completion:
1,222 donors and one yard. Required VIN/YMM/destination and stock agree with
all 1,222 frozen accepted identities. Five quarantined VINs remain independent
presence evidence. This proves local behavior, not a new live closure.

`independent-optional-audit.json` uses Python BeautifulSoup to inspect native
labelled fields and primary image attributes independently of application code.
All 1,222 stocks, 1,221 valid primary images and 38 genuine supplied dates match
canonical output, with zero differences. The audit preserves the frozen oracle
image defect and performs no network effects.

```sh
bun test src/server/ingestion/aplus-*.test.ts
```

Focused tests cover native parsing, numeric punctuation, explicit empty h1
binding, supplier/owner checks, optional repeated fields, native arrival alias
boundaries, all-occurrence conflict quarantine, quality guards, serialized
resumption, closing changes, HTTP envelopes, wire bounds and callback failures.
`scripts/soak-aplus.ts` counts and discards results while round-tripping cursors.
It owns neither transport nor source admission.
