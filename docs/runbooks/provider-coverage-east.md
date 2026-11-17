# East provider coverage

Read-only qualification on November 17, 2026, based on
`feat/provider-coverage-launch-readiness`. The current connector registries,
the supplied November 16 discovery tally, `docs/provider-candidates.md` and
the prior platform discovery were checked before counting new businesses.

## Admitted businesses

| Business             | State | Tenant            | Published | Accepted | Rejected | Floor | Verified acquisition |
| -------------------- | ----- | ----------------- | --------: | -------: | -------: | ----: | -------------------- |
| Floras Auto Parts    | IN    | florasauto / 7176 |       583 |      581 |        2 |   193 | November 16, 2026    |
| T-ville Auto Salvage | KY    | tvilleauto / 2445 |       319 |      318 |        1 |   106 | October 26, 2026     |

Credits: **IN +1, KY +1**. Both are distinct businesses absent from the base's
registries. Other requested states receive no credit from this change.

Both use the existing enabled `hollanderstores` source. No new connector, flag,
schedule, dependency or credentials are needed. Its pause flag retains its
existing behavior. No production setting, inventory or deployment was changed.

Each complete native card roster is one `POST /VehicleDealerSearch` with
`hdnChangeDisplay=card`. Parsed rows exactly match the advertised count, and
independent closing rosters match every row and tenant-bound destination.
Only donor `VehicleDealerShowParts` links are admitted. The separate retail
vehicle catalogs are outside this integration.

Modern VINs pass the existing ISO 3779 check-digit validator. Floras has two
valid VINs with blank native models: `5LM5J7XC5SGL31025` and
`SALRG2RV2K2401126`. They remain rejects with presence preserved. T-ville's
`KM8SC83S21U132552` fails its check digit and is rejected without correction.
There are no duplicate VINs or destinations, and each yard stays below the
unchanged 10% rejection guard. No make or model is inferred from stock numbers.

Six NHTSA vPIC batches decode 251 distinct valid VINs with missing native makes.
All return concrete makes; the audited values extend the permanent seed.
Populated native makes keep priority. Acquisition dates are verified directly
on linked native part details: Floras stock `610161`, VIN
`2D4FV47V37H785448`, and T-ville stock `26T193`, VIN `1GCCS136248164449`.
These are freshness controls, not dates assigned to other donors.
`availableDate` remains null because rosters do not publish it per vehicle.

The full saved source now accepts **56,857 donors across 53 yards**. The source
floor rises by the new yards' 193 + 106 floors, from 18,638 to **18,937**.
Previous-count drift, duplicate, closing-census and response-size guards remain.

## Physical locations

| Business | Published physical address                    | Census latitude | Census longitude |
| -------- | --------------------------------------------- | --------------: | ---------------: |
| Floras   | 6233 North State Road 15, Leesburg IN 46538   | 41.323142147077 | -85.853812765981 |
| T-ville  | 794 Radio Station Rd., Tompkinsville KY 42167 | 36.723999637267 | -85.674204539050 |

The businesses' own sites confirm these addresses. Each Census
`Public_AR_Current` response has exactly one matching address. These are street
range interpolations. T-ville's Hollander profile lists a PO box, which is not
used as the physical yard address. `east/locations.json` binds the evidence.

## Requests and fixtures

Normal runs add **four Hollander POSTs**, two per new business, for opening and
closing rosters. The complete configured source needs 106 roster requests,
plus uncached make batches and any bounded retries. The 251 seeded makes avoid
repeating the six qualification vPIC requests. New missing makes use batches
of at most 50. No per-donor detail crawl is added to ingestion.

Qualification fixtures and receipts are under
`src/server/ingestion/hollanderstores-test-fixtures/east/`. The qualification
receipt set contains 21 logical requests: ten Hollander reads, six vPIC POSTs,
three business-site reads and two Census lookups. Two further live reads use
the actual production HTTP client and check their parsed rosters against the
qualified census. Ordinary site redirects are followed during qualification.
Initial discovery opening captures retain exact bytes and hashes but lack
request timestamps. Later qualification requests are serial with at least
three-second gaps. All use a normal Chrome User-Agent. No URG crawl was run.

Offline tests replay opening/closing rosters, production-client captures,
dates, location evidence, vPIC responses and byte receipts. Existing whole-source
tests exercise durable checkpoints, closing guards and terminal emission with
the expanded registry. No database or publication workflow is used.

## Leads not admitted

Ario's public directory and 13 unfiltered rank windows were examined for the
following six leads. Every nonempty feed was fully enumerated to its advertised
bound. `east/discovery.json.gz` retains the directory records and response data.
This screen costs 18 requests: two discovery reads, one directory read, the
initial grouped window, two repeated discovery reads for the follow-up session,
and twelve remaining grouped windows. It does not change the allowlist.

| Lead                     | State | Result                                                                                                                                                         |
| ------------------------ | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Blue & Gold Auto Salvage | SC    | Public Ario search returns zero inventory. No VIN-bearing feed qualified.                                                                                      |
| Youngs U-Pull-It         | SC    | Public Ario search returns zero inventory. No VIN-bearing feed qualified.                                                                                      |
| Bessler's, Louisville    | KY    | All 341 rows enumerated. Newest placed date February 28, 2025. Stale.                                                                                          |
| Bessler's, Wilder        | KY    | All 619 rows enumerated. Newest placed date July 19, 2021. Stale.                                                                                              |
| Bessler's, Hebron        | KY    | All 1,264 rows enumerated. Newest placed date March 31, 2025. Stale. These three locations would count as only one business.                                   |
| U Pull It IA, Des Moines | IA    | All 815 rows enumerated. Newest placed date July 31, 2026. Stale.                                                                                              |
| Donovan Salvage Works    | DE    | Hollander's directory and public profile confirm the business and address, but do not establish a complete VIN-bearing donor feed. Not qualified in this pass. |
| Ripple's Auto Parts      | MD    | Initial roster acquisition did not complete before the exploratory request was canceled. No census, accepted count or provider credit is claimed.              |

The initial Hollander seller-directory traversal and ZIP searches supplied
leads, not a proof of complete platform coverage. Earlier rejected leads were
not reclassified as qualified. This is a bounded discovery pass, not an
exhaustive statement that the other target states have no eligible businesses.
