# DE, WV, ME, RI, VT and HI yard discovery

Observed November 17, 2026. Base: `91dcf455fa9c40f3ccb5882dfa265099d89e14e5`
on `feat/provider-coverage-launch-readiness` (PR #176).

No additional provider qualified. This pass changes research documentation only.
It does **not** establish that any state has no qualifying public inventory:
unreachable sites, Facebook failures, stale identities and listing-only businesses
remain open recovery work.

## Artifacts and counts

- [Business census](businesses.csv): one row per merged business/location record,
  including every screened candidate, sources, endpoint checks and disposition.
- [Qualification evidence](qualification-evidence.json): sanitized observations
  for the strongest leads. Catalog totals and samples are not accepted censuses.
- [Request accounting](request-summary.csv): logged top-level HTTP attempts by
  requested host, including failures and retries.

| State | Candidate records screened | Records with endpoint checks | Additional credits |
| ----- | -------------------------: | ---------------------------: | -----------------: |
| DE    |                         46 |                           28 |                  0 |
| WV    |                        121 |                           61 |                  0 |
| ME    |                        148 |                           82 |                  0 |
| RI    |                         97 |                           56 |                  0 |
| VT    |                         44 |                           19 |                  0 |
| HI    |                         25 |                           16 |                  0 |

These are directory/business records, not a count of confirmed operating salvage
yards. They intentionally retain scrap processors, retail/repair false positives,
old trade names and uncertain locations. Known aliases were merged; separate
reported locations were retained. Endpoint checks include linked directory
microsites and corporate sites, which do not establish a physical donor yard.
Blank city/website cells mean the value was not established.

`inventory found (y/n)` means a public vehicle catalog/gallery was observed, or
an existing qualification was reused. `n` means none was established in this
pass, including where access failed. It never proves inventory is absent.

## Sources and method

The census combines these overlapping sources, rather than limiting discovery
to known platform directories:

| Source                                         |  DE |  WV |  ME |  RI |  VT |  HI |
| ---------------------------------------------- | --: | --: | --: | --: | --: | --: |
| Junkyards Near Me individual listings reviewed |  16 |  20 |  93 |  61 |  31 |   1 |
| Car-Part state directory names                 |  18 |  24 |  42 |  44 |  12 |   6 |
| ARA public state member responses              |   1 |   2 |   2 |   7 |   3 |   0 |

Car-Part state directories use
`https://www.car-part.com/Directory/Recyclers/Online/USA/<state>.htm`.
They supplied yard identities, not a scraped parts catalog or donor census.
ARA's public directory API is
`https://directory.a-r-a.org/wp-json/geodir/v2/members?per_page=100&region=<state name>`;
each response contained fewer than 100 members.

Additional sources included Google Maps/business listings and web searches for
salvage, auto recycling, wrecking, junkyards, pick-and-pull and truck parts, with
separate Hawaii island and West Virginia truck searches. Yelp-style listings and
exact-name searches helped recover sites and Facebook pages. Search results for
unrelated businesses were not treated as first-party evidence.

Association sources:

- [Maine Auto Recyclers Association](http://www.maineautorecyclers.org/Members.html):
  35 in-state entries, excluding commented-out HTML.
- [Auto Recyclers Association of Rhode Island](http://www.arari.org/js/members.js):
  11 in-state entries.
- [West Virginia Recyclers Association](https://www.westvirginiarecyclers.org/members.html):
  linked and unlinked members, including industrial recyclers.
- Vermont association domain `vermontara.com` failed DNS; ARA and other sources
  remain represented. No verified separate DE or HI association roster was found.

For discovered URLs, the pass checked public pages, inventory/arrival links,
iframes and frontend platform hints. API discovery preceded donor-page crawling.
Failed sites received recorded protocol/host corrections where available.
First-party identity mismatches were retained instead of crediting another
state's inventory. Existing qualifications and saved rejections were reused.
Blue & Gold, Youngs, Bessler's, Donovan and Ripple's were not reinvestigated.

Requests used a normal Chrome User-Agent, serial local access and spacing
(at least 1.5 seconds, or 3.5 seconds for gated requests). URG requests held
`flock /tmp/jyi-urg-gate.lock`. No messages, quote forms, accounts, purchases,
production writes or administrative mutations were submitted. Capital City's
public AJAX request was the read-only year/make search action used by its site.

## Qualification and strongest leads

Qualification still requires VIN/check-digit validation (or a genuine pre-1981
serial), year/make/model, owned yard location, destination, complete enumeration
and a newest acquisition within roughly 60 days. Part import/update dates,
marketing totals and photo galleries alone do not establish those properties.

| Candidate                 | Observation                                                                                                                                                                                                                                                               | What would unblock it                                                                                                                                  |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| West Side, Laurel DE      | Custom `/api/vehicles` advertises 5,987 donors. Four details expose YMM but no donor VIN; all 133 associated part VIN fields are null.                                                                                                                                    | Public VIN/serial coverage and actual acquisition freshness, followed by full enumeration. The sample does not prove that all 5,987 records lack VINs. |
| Capital City, Johnston RI | URG tenant `CC02`, directory `used-parts`. Native `/used-parts/makes/` returns WordPress HTTP 500 on HTTP and HTTPS, including corrected browser headers/cookie. Its public `getMakesIIS` AJAX search also returns 500; the legacy make selector returns only whitespace. | Restore the native graph/API, then verify complete own-yard census, checksums and freshness.                                                           |
| I-81, Martinsburg WV      | Three native GoDaddy vehicle gallery pages expose YMM/photos without observed VINs. Advertised Hollander tenant, including `/VehicleDealerSearch`, redirects to generic HollanderParts.                                                                                   | An owned complete VIN-bearing vehicle roster and current acquisition evidence.                                                                         |
| K & R, Providence RI      | Advertised arrivals PDF has five image-only pages. All were rendered and inspected: ten donor photos, 2013/2014 camera stamps, PDF metadata dated 2014-09-05.                                                                                                             | A current complete VIN-bearing feed with acquisition dates.                                                                                            |

Other dispositions matter for avoiding repeat work:

- Hall's Garage RI recovered from an initial 429; its cars-for-sale page explicitly
  says no vehicles are listed. Dead Jeep RI and County Auto Salvage DE expose
  Shopify parts categories, without a verified complete donor feed. County's suite
  address also does not establish a physical yard.
- Sun ME exposes an old Joomla/RokSprocket gallery and a Car-Part parts selector.
  Auto Mill and Bob's ME expose retail VIN-bearing vehicle catalogs, but salvage
  donor scope, acquisition freshness and complete enumeration remain unverified.
- Brown's VT retains the earlier shared-pool cap rejection. A 1,325 Silverado
  badge returned only 500 records across suppliers; filtering by own supplier
  cannot recover the missing census. This pass did not repeat that census.
- Legacy Hilo HI, Ed Slaughter DE, Lambert WV, Mason ME and Pro Auto ME URLs now
  identify businesses elsewhere. Their inventory cannot be credited to the listed
  state. Parked/unrelated domains are not evidence of closure.
- Rasco WV remains a worthwhile heavy-truck access recovery lead. Protocol and
  host retries did not yield usable first-party content. Browser automation was
  unavailable, so no rendered inspection of challenged pages is claimed.

The starting saved publication audit gives DE 0, WV 0, ME 1, RI 1, VT 1 and HI 1
publishable credits. Eagle WV is configured/enabled, but its saved ordinary
Volkswagen Atlas route advertises two vehicles and returns empty without a saved
successful recovery. Its historical 1,448 accepted vehicles do not add a new
credit here. Existing credits are White & Bradstreet ME, Johnston Row52 RI,
LeBlanc VT and Hawaii Parts HI. See the platform ingestion runbooks for those
qualifications and the Eagle/Brown's safeguards.

## Limits and repeat-run cost

`request-summary.csv` contains 948 logged attempt entries across 333 requested
hosts: 947 completed request records and one interrupted attempt with an unknown
wire outcome. These are not exact wire-request counts. Automatic redirect hops,
search/maps connector calls and browser startup attempts are outside that count.
Cached reads add no receipt. Some endpoint evidence is reused across aliases or
reported locations, so CSV page-check counts must not be summed as network calls.
Raw captures and scripts remain local under `.scratchpad/provider-small-east/`;
only sanitized evidence is committed.

No ingestion request budget or floor is introduced because no provider ships.
For West Side's advertised size, a hypothetical details-only VIN feed would cost
60 list pages plus 5,987 details, or 6,047 requests per full run. That is a
conditional estimate, not a completed census or a proven pagination guarantee.
Capital City's complete-run budget remains unknown until its graph works.

The unresolved CSV rows are the recovery queue. Directory coverage and the
checked pages cannot prove absolute absence of public inventory, continued
operation, or exhaustive coverage of every business in a state.

## Validation

- `bun run lint`: passed.
- `bun run typecheck`: passed.
- `bun test src/server/ingestion/provider-coverage-go-live.test.ts`: 141 passed,
  zero failed.
- The broader ingestion suite was stopped after several minutes without progress
  in an unrelated Hollander census test. It is not reported as passing.
- No connector, configuration, floor or fixture changes were needed. CSV shape,
  statuses, counts, URL sanitization and whitespace were checked before filing.
