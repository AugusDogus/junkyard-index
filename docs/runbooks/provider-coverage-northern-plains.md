# Northern Plains and Alaska yard sweep

Observed November 17, 2026, against
`feat/provider-coverage-launch-readiness` at `91dcf455`.

One new provider qualifies: **Vander Haags Sioux Falls, SD**, with 276 accepted
donor trucks from a complete 287-truck yard census. It ships enabled. MT, WY,
ND and AK have no additional qualified provider from this pass. Unresolved
identities and inaccessible websites remain, so this does **not** establish
that those states have no qualifying public inventory.

| State | Business listings/leads checked | New credits | Prior providers | After this change |
| ----- | ------------------------------: | ----------: | --------------: | ----------------: |
| MT    |                              94 |           0 |               0 |                 0 |
| WY    |                              47 |           0 |               0 |                 0 |
| ND    |                              53 |           0 |               0 |                 0 |
| SD    |                              76 |           1 |               1 |                 2 |
| AK    |                              48 |           0 |               1 |                 1 |

## Evidence and interpretation

The [318-row CSV](provider-coverage-northern-plains.csv) records every retained
business identity or lead, including aliases, directory-only identities,
unresolved access and irrelevant directory results. The eight columns are
name, city, state, website, inventory found (y/n), platform, qualification
result and reason. The [source ledger](provider-coverage-northern-plains-sources.json)
retains discovery URLs, attempted website URLs, statuses, browser outcomes and
exact-name search queries.

"Checked" means the business listing or carried-forward lead was investigated.
It does not mean every listed business still operates or every operator
website was accessible. An empty website means no verified operator URL was
located, not that an unvisited website was rejected. `inventory found = n`
means no public per-vehicle roster was established at the checked sources;
read the qualification result and reason to distinguish unresolved cases from
component-only sites. Public retail vehicle listings can have `y` while
failing donor qualification. Out-of-scope results remain visible for audit. Of the 318 listings, 203 remain
unresolved, 99 are not qualified, 13 are out of scope, two are existing providers
and one is newly qualified. The unresolved listings are retained for recovery,
not counted as evidence that a state lacks qualifying inventory.

Aliases sharing an address, phone or operator were consolidated. Corporate
locations stay separate where the evidence distinguishes physical yards.
Uncertain identities remain unresolved, including the mixed Salt Lake
City/Rock Springs address for Penguin/Five Star and the carried-forward Grosz
lead. They receive no provider credit.

## Discovery coverage

- State and city map/business searches, including heavy-truck salvage, followed by exact business-name searches for directory-only leads.
- Salvage-Parts.com, UsedAutoPartsDealers.com and JunkyardsNearMe.com state listings and individual business profiles, plus Yelp-style results returned by business searches.
- [Car-Part's public yard-name directory](https://www.car-part.com/dealersaz.shtml), with 36 entries in the five states. Component searches did not establish donor qualification.
- [ARA's public member directory](https://directory.a-r-a.org/), using its state-filtered member API. Equipment vendors and association offices were distinguished from yards.
- [North Dakota association members](http://northdakotaautorecyclers.com/members.htm), including Neameyer Body Shop and Wil's Body Shop. The published South Dakota association site did not provide a usable member roster.
- Interstate and regional-town searches: Billings, Missoula, Miles City, Great Falls, Butte, Bozeman, Kalispell, Helena, Havre and Glendive; Cheyenne, Casper, Gillette, Sheridan, Laramie, Rawlins, Rock Springs, Evanston and Riverton; Fargo, Grand Forks, Bismarck, Minot, Dickinson, Williston and Jamestown; Sioux Falls, Rapid City, Aberdeen, Watertown, Pierre, Brookings, Mitchell and Yankton; Anchorage, Fairbanks, Wasilla, Kenai, Juneau, Kodiak, Ketchikan and Tok.

Initial Alaska map searches that inherited the wrong geographic location were
discarded and replaced with explicit Alaska city coordinates. Unrelated Bing
results were not treated as evidence. Search-engine errors were retained and
retried with revised requests. Neither search failure nor HTTP blocking is a
negative inventory finding.

Published operator sites and linked inventory pages were checked for native
APIs before considering page enumeration. HTTP/HTTPS and browser retries were
used for access failures. Facebook pages were checked when identified;
unofficial business-place pages were labeled as such. Requests used a normal
browser User-Agent and serial pacing. URG requests held
`flock /tmp/jyi-urg-gate.lock` with a completed-request gap. No external query
or provider request included the project or owner name.

The expressly excluded Colorado Auto & Parts, Jalopy Jungle, Liggett, Holst
and Spalding investigations were not repeated. Existing `cstruck` (SD) and
`northwest` (AK) are baseline credits, not discoveries from this sweep.

## Best near-misses and recovery paths

| Business                              | Finding                                                                                                                                                                                                 | What would unblock qualification                                                                                       |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Nordstrom's, Garretson SD             | URG CC24 latest arrivals has 60 VIN-bearing cards, newest November 16. Current `/parts/FORD` advertises 506 F-150s; its linked `/parts/FORD/FORD_F150_PICKUP/` returns No Results Found and zero cards. | Restore model vehicle responses or expose a finite complete donor feed. Recent arrivals alone do not prove the census. |
| Mr. R's, Buffalo WY                   | URG WY01 WordPress index reveals `/latest-arrivals/`. HTTP and browser show a 60-vehicle counter but zero actual donor cards or VINs.                                                                   | Restore the public cards/feed and establish complete inventory beyond a recent-arrivals cap.                           |
| Moore's, Rapid City SD                | Browser access recovered. Auta.com catalog has 19 listings, including grouped part-outs. Sample 1979 Dodge D150, VID 111292970, has no VIN or serial.                                                   | Publish individual serial-bearing donors, a complete roster and freshness evidence.                                    |
| Hazer's / West Fargo Self Service, ND | Current Hazer's website works. The self-service `/yard-vehicles` page still says inventory is under construction.                                                                                       | Publish a complete, current VIN/serial-bearing yard roster.                                                            |
| Hatch Trucking, Box Elder SD          | Prior native shop has 742 components; a VIN-bearing cab assembly does not establish a donor census.                                                                                                     | Publish a complete whole-donor catalog with native yard attribution and freshness.                                     |
| Hanser's, Billings MT                 | Published sites fail HTTP/HTTPS checks; browser returns an HTTP/2 protocol error.                                                                                                                       | Recover the current operator-controlled catalog endpoint. Inventory remains unverified.                                |
| MSI, Fairbanks AK                     | Car-Part still lists the business, but its published operator domain does not yield a usable site after HTTP/HTTPS and browser attempts.                                                                | Locate a working current operator feed and audit its donor scope, identities, completeness and freshness.              |

Knik, Interior, Hilltop, Green Meadow, Dietz, CF, R&J, Timberlane, Wisher and
other component-only shops remain candidates if they expose a whole-donor
roster. Repairable/retail sales, component catalogs and social posts do not
substitute for the required complete current inventory.

## Integrated provider and validation

See the [Vander Haags ingestion runbook](vanderhaags-ingestion.md) and
[qualification receipt](vanderhaags-qualification.json). The source validates
modern check digits, preserves pre-1981 serials, binds stock and native IDs to
the Sioux Falls yard, checkpoints complete catalog identities and fences
completion with another full census. Its sole yard/source floor is 95.

At the qualified census, a default run uses **412 inventory document requests
across 24 checkpoints**, plus browser assets and WAF challenge traffic. A fresh
production-transport checkpoint emitted 12 validated trucks in 17 document
requests. A complete saved-response replay yielded 276 accepted, 11 rejected
and zero duplicates. No arrival dates were invented from video publication.

Fixture tests cover all five captured catalog pages, donor identity and
description conflicts, pre-1981 serials, check digits, truncation, pagination,
resuming, duplicate VINs, floors, cumulative rejects and closing fences. The
count-only soak respects its requested cap. Lint, typecheck and relevant
offline checks passed: 437 tests across 10 files. Two existing large-cursor
tests exceeded the default five-second timeout; the complete relevant suite
passed with a 20-second test limit.

No merge, deployment, production flag change or production database write was
performed.
