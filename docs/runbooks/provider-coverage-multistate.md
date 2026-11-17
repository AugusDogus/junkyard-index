# Multi-state provider qualification, November 17, 2026

This pass adds **one provider-state credit: AutoRecycler / Ario in Colorado**,
through Colorado Auto & Parts in Englewood. Colorado rises from 5 to 6 providers;
all other states are unchanged. The requested November 17 tally therefore moves
from **223/500 to 224/500**, or 226 to 227 uncapped provider-state pairs.
This is one new yard in an existing multi-state marketplace, not a new source ID.

Baseline: `feat/provider-coverage-launch-readiness`, commit
`91dcf455fa9c40f3ccb5882dfa265099d89e14e5`. Reconciled against
`tally-nov17.json`, `tally-discovery-nov16.json` and `docs/provider-candidates.md`.
Business ownership, rather than a new domain or platform, determines duplication.
A native yard already credited separately cannot earn another marketplace credit.
GA, PA and TX are at 10, FL at 12 and MI at 11, so another business in those states
adds no capped target credit. Auctions remain excluded.

## Ranked multi-state candidates

These are **potential capped credits**, not admitted coverage. Counts use the
verified business footprint and subtract its existing credits and saturated
states. A corporate branch or parts supplier is not proof of a donor catalog.
Only the Ario Colorado row below is admitted.

| Rank | Business or marketplace                                                           | Potential capped credits | Finding                                                                                                                                                                                                                                                                                                                                                                               |
| ---- | --------------------------------------------------------------------------------- | -----------------------: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | [Aesop Auto Parts](https://aesopauto.com/)                                        |                        9 | Official 16-location, 11-state footprint: AL AR GA IN MO MS NC OK TN TX VA. GA and TX are saturated. Shared URG declaration has 15 supplier codes. Ford F150 menu badge is 4,247, but the model page exposes 30 cards, including with the usual `urg_hv=1` cookie. No complete donor enumeration or physical supplier mapping established. Not admitted.                              |
| 2    | [Fenix Parts](https://fenixparts.com/locations/)                                  |                        8 | Corporate footprint: CA FL GA IL IN KY MA MI NJ NY NC OH PA TX. GA and NY already have Fenix U-Pull credits; FL MI PA TX add no capped credit. The inspected public URG catalog declares only CA76/FL27/OH16/NY16/TX62, not the whole corporate footprint. F150 returns exactly 500 cards and triggers the existing incomplete-page rule. No complete feed established. Not admitted. |
| 3    | [Vander Haag's](https://www.vanderhaags.com/map.php)                              |                        6 | Official locations span IA IN KY MO OH SD TX; TX is saturated. Native manufacturer/Parts-Unit search returns HTTP 202 with an AWS browser challenge, including after normal Firefox headers and an exact published link. HTP resale catalogs do not substitute for its dismantling roster. Access and enumeration remain unresolved.                                                  |
| 4    | [Carolina Pick-N-Pull](https://carolinapicknpull.com/inventory/)                  |                        2 | Wilmington/Fayetteville NC and Conway SC. Native selector API and a legitimate Conway Ford/Mustang query work. Eleven rows expose year/make/model, row and arrival date, but no VIN or serial. No qualifying API/feed found.                                                                                                                                                          |
| 4    | [DEX Heavy Duty Parts](https://dexheavydutyparts.com/about-dex-heavy-duty-parts/) |                        2 | Official Advance NC and Oklahoma City OK dismantling facilities. Public search exposes components, not an enumerable VIN-bearing donor roster. DNS failures recovered with ordinary requests. Not admitted.                                                                                                                                                                           |
| 4    | [Spalding Auto Parts](https://spaldings.com/)                                     |                        2 | WA/MT footprint. Public URG tenant AA72; F150 badge 612 but 30 returned cards. No complete donor enumeration or branch attribution established. Not admitted.                                                                                                                                                                                                                         |
| 7    | AutoRecycler / Ario: Colorado expansion                                           |           **1 admitted** | Complete native Crush client 1004 census below. Existing customers and native-source mirrors do not add states.                                                                                                                                                                                                                                                                       |

B&R, TruckPartsInventory, MyLittleSalesman and TruckPaper are unranked because
this pass did not establish a complete, qualifying donor footprint. Assigning
state credits from their marketing or directory pages would overstate coverage.

## Colorado: admitted native marketplace feed

The public Ario directory identifies Colorado Auto & Parts as yard
`a3d5bad0-b580-4578-b0a4-3f33ddfd2b89`, organization
`1e82bb80-912f-4f65-8f65-f2751447ae0e`, `source=crush_xml_seed`,
`crush_client_id=1004`. It publishes 2151 W Radcliff Ave, Englewood CO,
303-761-0112, and coordinates 39.636828, -105.0107397. These are provider-published
coordinates, not independently geocoded points. This native feed/stock evidence
matches the previous Ario expansion qualification method. It is not an inferred
Ario customer iframe or a marketplace copy of another configured business.

Read-only anonymous API: `POST /functions/v1/search-inventory` on Ario's public
Supabase host, discovered by its existing browser client. Complete 100-rank
windows at offsets **0, 100 and 200**, followed by an independent opening read,
return **283 / 283 unique accepted donors**, with no rejects, duplicates,
removed rows or missing ranks. Every modern VIN passes the check digit;
year/make/model, yard and destination are native fields. Opening/closing items
and total agree. Newest accepted arrival: **2026-10-07**, 41 days before this
qualification. Dates reflect arrivals, not synchronization. The existing 60-day
freshness rule will stop publishing this yard if it does not refresh.

The enabled existing `autorecycler` source now includes this yard. Its **94-donor
floor** is one third of the accepted census, rounded down. A fresh census below
that floor quarantines this yard and preserves prior inventory. Changing native
feed source/client identity fails before inventory reads. Existing check-digit,
10% rejection, 25% duplicate, closing-catalog, 50% previous-yard drift and stale
removal guards still apply. No new flag is introduced.

A standalone census requires **four inventory calls**, plus ordinary public key
and directory discovery if cold. In the deployed grouped protocol, Colorado fits
inside the existing 33-window bound of 3,297 ranks: **37 nominal daily requests**
(two public bundle discovery, one directory, 33 grouped windows, one closing).
Its addition costs zero extra grouped requests at those frozen bounds. Larger
live counts can increase this; the existing 48-request rolling-hour budget and
durable waits remain enforced. Offline grouped replay combines separate saved
captures and verifies 34 yard publications and 32,453 accepted donors. It does
not claim a new simultaneous live census of every existing yard.

## Other rejections and unresolved access

- **B&R Autowrecking:** the ordinary public bundle names `inventory.wkr.li` and
  `misc.wkr.li/store`. Both API hosts disallow crawling. One early inventory
  probe returned 401 before that robots result was reviewed. API investigation
  stopped. Public SSR pages alone do not enumerate inventory. No login attempted.
- **Foss:** the official iframe is native Ario, but its six NC/VA yards are
  already configured and credited. Zero new states.
- **Bessler's:** old Ario KY feeds show newest sampled arrivals in 2021 or 2025.
  The current self-service homepage links RTP yards in KY/NC/TN, all already
  credited to RTP. The full-service homepage embeds Road Tested Parts. No new
  business-state credit is established by its old name.
- **Ario mirrors:** Joliet IL, Grandpa John's WI, Tri-State U-Wrench MO and
  U Pull Auto Parts Pocatello ID already have native connectors. Do not count
  them again. Five Jalopy Jungle ID samples have no VINs and old sync dates.
  Blue & Gold, Young's and Jalopy Wizards SC return zero items. Des Moines IA
  has a newest sampled arrival of July 31. U-Pick-It AZ samples are from 2025.
  None qualifies as new current marketplace coverage.
- **HeavyTruckParts:** screened store categories for Frontier MI, Holst ID,
  Rhino NJ, ERN AL, Salvage City SC, Ace CA, Boots & Hanks PA, Jackson's NC,
  US Truck Parts Dallas TX, David's TX and Valley IN have no Complete Vehicle
  category. Stateline OH has nine listings, largely trailers and a $37,700
  complete truck. Valley MI's 24 listings are Unit for Sale. Tim Jordan TX's
  23 listings mix equipment, trailers, buses and rows missing identity.
  Quality Bus MN has one 2004 Gillig marked “PICK UP SCHEDULED,” without a
  demonstrated current dismantling date. CRJ TX advertises 47 complete vehicles,
  but no full donor census was attempted. None supplies a qualified new state.
  No `page=` URL was requested in this pass, respecting HTP robots restrictions.
- **Recyclers.net:** the public ITrack directory spans many states, but the
  complete Parts Cars Or Trucks query returns only eleven GA rows. Nine lack
  VINs; the two BMW rows lack demonstrated freshness. A parts-vendor directory
  does not prove donor coverage. No connector added.
- **TruckPartsInventory, MyLittleSalesman, TruckPaper:** ordinary Chrome and
  Firefox requests with normal Accept/Accept-Language headers still return 403.
  Access remains unresolved, not disproven inventory. No challenge bypass,
  alternate-origin routing, login or paywall bypass was attempted. MLS also
  disallows `/api`. TruckPaper/MLS would require explicit salvage-only scope and
  auction exclusion before any admission.
- **LKQ Heavy Truck:** its public app exposes a component-product search API and
  VIN-bearing vehicle information on parts. No independently enumerable current
  dismantling roster established. Existing HTP LKQ catalogs are resale scope.
- **Express Pull N Save and Mid-South U-Pull-It:** inspected sites identify TN
  yards only, outside the requested multi-state discovery lane. Fox Auto Parts
  redirects to Fenix and cannot count as another business.

## Evidence and verification

`src/server/ingestion/fixtures/ario/colorado-auto-and-parts-englewood-co.json.gz`
contains complete original JSON envelopes for every census window and closing.
`yards.json` retains the exact directory feed authority and coordinates.
`fixtures/multistate/research.json.gz` retains selected native research responses
and grouped Ario screening results; these are research evidence, not admitted
inventories. `fixtures/multistate/requests.json` contains **132 logged requests**:
123 general requests and nine Ario client requests. Failed DNS/TLS/HTTP requests
are retained. No keys or request headers are saved.

The general research ledger began after initial unlogged probes, so 132 is not
claimed as a complete exploration total. Two early research batches briefly
overlapped before a shared fetch lock was added. The admitted Colorado census
was serial and paced by the existing Ario client, at least 2.2 seconds after
responses. No `/yard/` Ario pages were fetched. Ordinary public discovery, API
calls and robots reads were used; the Colorado owner-site TLS certificate failed
validation, and no TLS verification bypass was used.

Validation: repository lint, TypeScript typecheck, changed-file oxfmt, and offline
Ario connector/client/durable replay, freshness and terminal validation tests.
The new regression tests check complete Colorado replay, strict VINs, physical
location, the 94-donor floor and changed native feed authority before emission.
No production write, deployment, merge or external message is part of this work.
