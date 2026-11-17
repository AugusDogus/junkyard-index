# West and plains provider expansion

Public read-only qualification on November 17, 2026, based on
`feat/provider-coverage-launch-readiness` (PR #176). Four new businesses add
one credit each in **NM, NE, WA and OK**. No additional credits in MT, WY, ND,
AK, SD, ID, NV, CO or KS. Existing businesses and extra locations earn no credit.

## Qualified Hollander tenants

| Business                           | State | Tenant         | Published |  Accepted | Rejected |   Floor |
| ---------------------------------- | ----- | -------------- | --------: | --------: | -------: | ------: |
| A-1 Auto Recyclers, Kirtland       | NM    | a1nm / 44      |     1,029 |       993 |       36 |     331 |
| Kramer's Auto Parts, Grand Island  | NE    | kramers / 1535 |         5 |         5 |        0 |       1 |
| Horseshoe Auto Wrecking, Bremerton | WA    | hsaw / 6605    |        33 |        33 |        0 |      11 |
| Midwest Auto Parts, Tulsa          | OK    | mwas / 7342    |       224 |       221 |        3 |      73 |
| **Total**                          |       |                | **1,291** | **1,252** |   **39** | **416** |

These businesses were absent from both the supplied discovery tally and the
base branch's configured providers. Big D, A-1 Crashed Cars, Smith Auto,
Roberts Parts-U-Pick, Rainbow, Pasco and All West Coast are already in the base
and earn no new credit here. A-1 in New Mexico is a different business from
A-1 Crashed Cars in Nebraska.

Discovery used Hollander's public `SellerDirectory` page and its own
`GetSellersByPostalCodeRadius` endpoint, with five regional searches centred
on Billings, Oklahoma City, Albuquerque, Anchorage and Reno. Their original
HTML responses retain business names, street addresses and explicit storefront
links. This found tenants absent from the earlier backlink-based investigation.
The searches are regional coverage, not a claim that every US tenant was found.

Each unfiltered native card response contains its complete advertised roster.
Independent opening and closing responses agree on every parsed record, its
order, VIN, stock, year, make/model and tenant-bound destination. There are no
duplicate VINs in the four additions and no changes to earlier yards' replay
counts. All modern accepted VINs pass the existing check-digit validator.
Each yard independently stays below the 10% rejection guard. Invalid records
remain explicitly rejected, with existing presence protection unchanged.

The native make is missing on 364 valid VINs absent from the existing seed.
Eight NHTSA batch requests, each at most 50 VINs, resolve all 364. Original
responses and exact membership are saved. Successful results extend the
permanent seed; no makes are guessed from Hollander model codes. Native makes
retain precedence. No production cache or database was written.

### Currency evidence and limitation

Hollander publishes no arrival date. As in the existing Hollander qualification,
currency uses the platform's recent vehicle-ID range, alongside its current
active parts roster. Maximum IDs are 72,813,986 (A-1), 72,747,439 (Kramer),
72,770,928 (Horseshoe), and 72,702,019 (Midwest), comparable to the recent
72.7–72.8 million records in the November 16 batch. This is an approximate
freshness proxy, not an independently dated arrival within 60 days. All canonical
`availableDate` values remain null. Physical availability of individual older
donors is not independently verified. Kramer is a small five-donor parts roster;
its full enumeration, not an assumed larger yard size, sets its floor.

### Physical locations

| Tenant  | Physical street address                          |        Latitude |         Longitude | Evidence                                                               |
| ------- | ------------------------------------------------ | --------------: | ----------------: | ---------------------------------------------------------------------- |
| a1nm    | 99 Road 6100, Kirtland NM 87417                  | 36.736807180137 | -108.345849168194 | Public seller directory; unique Census exact-address match             |
| kramers | 3405 North US Highway 281, Grand Island NE 68803 |      40.9644352 |       -98.3581909 | Native profile and official site; exact-address Google business marker |
| hsaw    | 7360 State Highway 3 SW, Bremerton WA 98312      | 47.505968517402 | -122.749153524785 | Native profile; unique Census exact-address match                      |
| mwas    | 3815 N Lewis, Tulsa OK 74110                     | 36.209247187407 |  -95.958181153993 | Native profile; unique Census exact-address match                      |

A-1's native About Us profile gives a PO box. Use the directory's physical
street address, not that mailing address. Midwest's logo says `Online Store`;
its directory entry explicitly binds `mwas.hollanderstores.com` to Midwest Auto
Parts, 3815 N Lewis, Tulsa, with the same phone as the native profile.

Census did not match Kramer under either address spelling. A Nominatim request
returned HTTP 429. Its official published website at `www.kramersautoparts.com`
works over its published HTTP URL and confirms the address and 308-384-1116
phone. Google's business marker `0x8799877132d8e29f:0xe9e10421b8e8b823` matches
that name, address and phone. The marker coordinates are used, not a viewport
centre. No coordinate is invented from the city name.

## Request budget and publication safeguards

The four yards add **eight serial Hollander POSTs per run**: one opening and one
closing response per yard. With the existing 51 yards, the warmed census costs
110 Hollander POSTs. Missing native makes incur at most 50 VINs per NHTSA POST;
the captured 364 new makes are seeded, so they add no daily live decode requests
until inventory changes. No vehicle detail crawl is needed.

The existing source runs enabled unless its pause flag serves false. No new
flag is introduced. Floors are `max(1, floor(accepted / 3))`. The source floor
increases by 416, from 18,638 to 19,054; the combined saved replay accepts
57,210 vehicles at 55 locations. Existing 10% rejection, 25% duplicate, 50%
previous-run drift, closing-census, body, row, cursor and request bounds remain.
The changed registry invalidates old scoped checkpoints, as designed.

The receipt corpus records 35 HTTP requests, including directories, eight NHTSA
batches, locations, native profiles, original roster captures and a failed
geocoder. It is a qualification evidence subset, not a ledger of every discovery
request. Two early exploratory Hollander requests overlapped. A process lock
then serialized the qualification phase with at least 4.2 seconds after each
completed request. Tests verify those gaps from the first NHTSA batch onward,
plus every saved response's byte count and SHA-256. Early unreceipted discovery
responses are retained without fabricated timestamps.

## Leads left out

| Lead / directory result                        | State                              | Reason                                                                                                                                                                                                                                                                                                                                                                           |
| ---------------------------------------------- | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Colorado Auto & Parts                          | CO                                 | Native inventory has 264 rows, with arrivals through November 9, but no VIN column. Ario advertises 283 rows and its sampled newest placement is October 7, last seen October 8. The mismatched current native roster does not establish a complete current VIN feed. No Ario allowlist addition.                                                                                |
| Pick-A-Part Jalopy Jungle                      | ID                                 | Native ASP.NET search displays only year, make, model and row. Ario has five yard buckets, but sampled records lack placement dates and several directory entries lack physical coordinates. Last-seen timestamps alone do not prove a new vehicle within 60 days. No source added.                                                                                              |
| Auto & Truck Recyclers, Liggett                | WY                                 | Public inventory links lead to Car-Part parts-selection forms, not a complete VIN-bearing donor roster. No source added.                                                                                                                                                                                                                                                         |
| Holst Truck Parts                              | ID                                 | Native TPI Salvage catalog still needs a complete census and scope audit. The current template uses `/truck-description/?truck=...`, different from the earlier `/truck-details/` capture. Published page-size controls stop at 25. No underlying complete feed was established in this pass; the earlier incomplete capture and 429 do not qualify it. No partial source added. |
| Spalding                                       | MT / WA                            | Shared business/tenant was already rejected for unresolved physical-yard attribution in the supplied investigation. The directory maps the same storefront to both Missoula and Spokane. No guessed yard split or new credit.                                                                                                                                                    |
| Remaining regional Hollander directory entries | MT, WY, ND, AK, SD, ID, NV, CO, KS | No additional unconfigured target-state storefront surfaced in these five searches. Parts sellers without complete vehicle inventory do not qualify from a directory entry alone. This is not proof that no qualifying yard exists.                                                                                                                                              |

Other platforms' previously enumerated tenants and rejected leads were reviewed
in the supplied tally, platform investigation and existing runbooks. Their
results are prior evidence, not new live qualification in this pass.

## Offline verification

`hollanderstores-west-plains.test.ts` checks complete rosters, exact accepted and
rejected counts, ownership, geocodes, decoding membership, receipts and pacing.
Existing connector tests replay all 55 yards through durable checkpoints and
publication. No test contacts a provider. Run the Hollander tests,
`provider-coverage-go-live.test.ts`, lint and typecheck. No merge, deployment,
flag mutation or production write is part of this change.
