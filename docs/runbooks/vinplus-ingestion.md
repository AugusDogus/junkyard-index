# VinPlus app yards

See the current [source flags and census floors](provider-coverage-go-live.md).

Source `vinplus` is a generic, sequential traversal of independent businesses on
Texn's public VIN+ app. It runs by default. The boolean
`ingestion-source-vinplus` pauses this source when it serves false. Qualification and a
successful soak do not enable ingestion or authorize production writes.

## Published authority and physical yards

Each tenant has its own canonical yard, stock namespace, address and coordinates.
The public app is the inventory authority. Searchable apps are the fallback
destinations for their vehicles. No unsupported vehicle permalink is constructed.

| Yard                               | Yard code        | State | Public app slug             | Minimum accepted |
| ---------------------------------- | ---------------- | ----- | --------------------------- | ---------------: |
| U Pull Auto Parts Pocatello        | pocatello        | ID    | u-pull-auto-parts-pocatello |              236 |
| Ryan's Pick-A-Part                 | ryans            | MI    | ryans                       |              468 |
| US Auto Supply of Sterling Heights | sterling-heights | MI    | us-auto-supply              |              360 |
| YourPart (SA Recycling)            | hinesville       | GA    | yourpart                    |              154 |
| 195 Used Auto Parts                | killeen          | TX    | 195-used-auto-parts         |              519 |
| Pick Ur Part                       | lubbock          | TX    | pick-ur-part                |              361 |
| Indy U-Pull-It                     | indianapolis     | IN    | indy-u-pull-it              |              400 |

App URLs are `https://vinplus.texnrewards.com/parts/<slug>`. Configuration maps
these to exact backend yard IDs and names. All admitted tenants are single-yard
inventories. The first four use Crush with `STK` plus six digits; Killeen uses five digits. Pick Ur Part
uses YardSmart with numeric 12-digit, `PUP` or `XPUP` stocks and literal
`yardLocation=Lubbock`. Pocatello deliberately permits the
published `hide_vehicle_search=true` configuration. Its unauthenticated public
inventory API qualifies even though its page hides the search form. Its public
app asset exposes no vehicle-detail route, and no alternate inventory destination
has been verified. Pocatello cards and alerts therefore explain that vehicle
search is hidden and ask users to contact the yard with the VIN and stock number
to confirm availability. They do not offer a misleading inventory link; the yard
website remains the public app.

Sterling Heights is a different physical yard from source `pontiac`. Ryan's is
its own business in Detroit. YourPart's own site returned HTTP 500 during
qualification; its VinPlus app is the source and destination. Texas was qualified
before Indy; both Killeen and Pick Ur Part qualify. Pickers, including its
native-authoritative enrichment and location resolution, keeps its existing
behavior.

| Yard                | Address                                        | Census latitude, longitude         |
| ------------------- | ---------------------------------------------- | ---------------------------------- |
| Pocatello           | 9587 N Philbin Rd, Pocatello ID 83202          | 42.899466372540, -112.495800567155 |
| Ryan's              | 9309 Hubbell Street, Detroit MI 48228          | 42.363251568324, -83.187495433027  |
| Sterling Heights    | 7575 18 1/2 Mile Rd, Sterling Heights MI 48314 | 42.601893504252, -83.036124488316  |
| YourPart            | 6880 US Highway 84, Hinesville GA 31313        | 31.767772464280, -81.643658295697  |
| 195 Used Auto Parts | 12077 State Highway 195, Killeen TX 76542      | 31.017893889633, -97.753710608874  |
| Pick Ur Part        | 4125 E Slaton Rd, Lubbock TX 79404             | 33.520132845259, -101.780012462231 |
| Indy U-Pull-It      | 940 W 16th St, Indianapolis IN 46202           | 39.788722423552, -86.175452072595  |

Coordinates come from US Census `Public_AR_Current` one-line exact-address
matches. They are street-range interpolations, not rooftop points. Pocatello's
match omits the input N direction. Ryan's publishes Hubbell **Street**, which
Census confirms; the earlier investigation called it Avenue. Original Census
responses are frozen in `vinplus-test-fixtures/qualification.json.gz`.
Ryan's and US Auto Supply publish their addresses at
`https://ryanspickapart.com/` and
`https://usautosupplymi.com/upull/sterling-heights/`. Pocatello's address is
corroborated by Yellow Pages, u-pull-it.com and Chamber of Commerce listings.
YourPart's address comes from the public listing for yourpart.com documented
in the provider coverage investigation.

195 Used Auto Parts, Killeen, qualifies under the per-yard 1% unreachable rule.
Its saved opening census recovered 1,575 of 1,581 advertised rows after year/make
discovery, observed-make supplements and the public make directory. Six rows
(0.379507%) are unreachable: four from 2006, one from 2007 and one from 2008.
They are reported as a count warning, without inventing identities or adding them
to rejected VIN presence. Of the reachable rows, 1,558 qualify and 17 are
rejected. Its published address at `https://195usedautoparts.com/` has a Census
exact-address match. No new live inventory requests were made for this update.

Pick Ur Part's official `https://pickurpart.com/` and `/inventory-search/`
pages publish its Lubbock address and link to the Texn app. Census confirms that
exact address. This resolves the earlier investigation's missing-address concern.
Its dates retain the published UTC offset, including fractional seconds.

## Complete enumeration and drift

Only public app, `/api/yard-info/<yard_id>`,
`/api/analytics/year-distribution?yard_id=<yard_id>`, `/searchVehicleHttp`, and
when needed `/api/vehicle-groups` are requested at
`https://inventory-search-api-581547763015.us-central1.run.app`. No admin,
private, alert-creation or image endpoint is used.

The backend silently caps search responses at 100 records, even reporting
`match_count=100`. Matching that field alone proves nothing about completeness.
The saved broad Pocatello response demonstrates this cap.

Opening year counts define finite partitions. Adjacent years are grouped only
while their total is at most 90. A year above 100 uses a capped discovery control
to obtain literal make selectors. Complete year/make reads must remain below 100. Missing makes are supplemented from other observed tenant records and,
if necessary, the app's published make directory. Discovery rows supply selectors
only and never add donors. Null make/model values are explicit public API year
controls, not wildcard strings. A missing selector or saturated make partition
still fails the source.

The year distribution is a cache that lags live search by days in both
directions. On November 18 and 19, 2026 US Auto Supply's searchable 1999 arrivals
and a real 1976 Cadillac Eldorado (added November 18) were missing from it. From
November 22 to 24 it kept one unchanged distribution while the yard turned over,
so it still counted 27 of 1,081 vehicles (2.5%) that complete live year searches
no longer returned, and on November 21 Ryan's 2008 search reached the cap above
its 95 advertised rows. Coverage therefore separates three cases:

- Year overcounts and unadvertised years are kept and reported as a warning.
- A shortfall in a year that an uncapped null-make search answered is lag: the
  search is the inventory authority, so those vehicles are treated as gone and
  not published, with a warning.
  - Confirmed lag: the same yard also has searchable vehicles the distribution
    does not count yet, so this run has shown it is stale. Confirmed lag may
    total at most 50% of that physical yard's advertised inventory. That is
    tighter than the per-yard floors, which sit near a third of each yard; the
    50% drift guard is source-wide.
  - Unconfirmed lag: nothing shows the distribution is stale, so the shortfall
    could instead be a search that silently returned fewer rows. It keeps the
    1% bound every shortfall had before lag was separated, which allows no
    unconfirmed lag at a yard under 100 vehicles.
  - Above either bound the crawl is rejected as transient, so it retries later
    the same day. A distribution frozen while a yard only loses vehicles, with
    no arrival to confirm it, therefore holds back every VinPlus yard until the
    cache refreshes, because the source publishes as one unit. It has not been
    seen: US Auto Supply's three frozen days still showed 17 arrivals.
- A shortfall in a make-partitioned year is unreachable: a vehicle may sit behind
  a make the controls never reached. That holds even after a large year has read
  every directory make: 195 Used Auto Parts kept the same 6 missing vehicles in
  2006 to 2008 on November 21, 22 and 23, 2026 under two different
  distributions, so those vehicles are hidden from make searches, not gone. Unreachable rows may total at most 1% of
  that physical yard's advertised inventory. Exactly 1% passes with a warning;
  above 1% fails deterministically, even when the same yard's lag would only
  have been a transient rejection.

Surpluses never offset either shortfall, and complete yards cannot mask another
yard's. A null-make response at the 100-record cap may be silently truncated
whatever the distribution advertises, so it is discovery only and never
admitted or replayed. Its range is bisected by year until each half is below the
cap. A capped single year is read by its discovered makes and then, unlike a
large year, by every other observed and directory make: its advertised count
comes from the stale distribution, so reaching it proves nothing and the
supplement never stops early. It reads every make in the union of observed and
directory makes that the year has not been read by yet (the directory listed 49
makes on November 23, 2026), and each read is replayed at close. Large years
that never reconcile read the directory first. Because capped reads never stop
early, the parser then knows the yard's remaining requests exactly and checks
them against its 1,024-control limit. A yard that cannot afford them is rejected
as transient, with no directory-make search made for those years. A yard or the
source that still reaches its request limit (1,024 per yard, 2,048 in all), for
example through large years alone, is also rejected as transient rather than
retried on the same saved evidence. The accepted November 22 and 23 runs used
1,012 of the 2,048 requests, so a capped year (about 110 requests at a 49-make
directory) cannot by itself exhaust the source limit. Those runs saved a 10.7 MB
cursor against its 16 MiB limit. Search responses there took at most about 1.8 KB
per record and 0.2 KB when empty, so a capped year of 200 vehicles adds about
0.7 MB at opening and close together. A cursor over 16 MiB fails the source, so
inspect the cursor size if several yards report capped years at once. A make
partition at the cap still fails the source.

Separating lag is a deliberate tradeoff. A backend that silently dropped rows
below the cap, identically at opening and closing, while the same yard also had
arrivals the distribution missed, would look like confirmed lag, so up to 50% of
that yard could be delisted with only a warning. The search has only ever been
seen truncating at the 100-record cap. The alternative, one tight bound for all
lag, meant a distribution frozen for days, as from November 22 to 24, failed
every same-day retry and held back every VinPlus yard, because the source
publishes as one unit.

Workflow runs stay pinned to the deployment that started them, so a cursor saved
by an older traversal is only resumed by that traversal. A cursor from before
capped null-make ranges were bisected diverges at its first null-make range of
exactly 100 rows (Ryan's 2008 on November 22 to 24) and fails on a newer
deployment with a search criteria mismatch. The cursor version was not bumped
because the shape is unchanged and no VinPlus cursor is reused across runs.

Make searches can return a different published make, as Killeen's Chrysler
query does for an Oldsmobile record. Response criteria must match the request;
returned YMM is preserved literally. Whole-record query overlaps count once,
retaining the maximum multiplicity observed inside one complete response.
This distinguishes overlapping searches from repeated backend rows.

The resulting opening record union accounts for every published year and the
total count, including explicit warnings for permitted unreachable counts. Each
warning names the yard, advertised total, unreachable total and year deficits.
Warnings reach the terminal connector result, durable ingestion logs and soak
output. They never become success-shaped donor rows or rejected VIN claims. Repeated stocks keep all their records. A conflicting stock
counts once as a rejected donor with no asserted VIN, following Pickers' stock
association rule. Identical stock repeats are provenance. Distinct stocks sharing
an agreeing VIN count as donor duplicates; contradictory YMM for one VIN fails.
A VIN at more than one configured physical yard fails the complete source.

Every enumerated partition is fetched again in closing. Whole records and order
must match, ignoring the derived `daysInYard` counter and the rotating signature
segment of YardSmart public photo redirects. Their host, filename, order and
all other record fields must remain stable. Unknown photo hosts compare
verbatim. Closing year counts,
full public config, any used public make directory and app body must agree too.
Only then can the canonical batch, rejected presence and yard callbacks run.

Every donor requires `inventoryVinWithCheckDigit` (including valid pre-1981
serials), usable published year/make/model and the exact configured physical
yard. Modern 17-character VINs must pass the ISO 3779 check digit. As in BYOT,
structurally valid VINs rejected for their check digit remain in observed-VIN
presence to protect prior inventory, but are not published. No VIN-derived YMM
or identity repair is introduced. Optional color, row,
engine and transmission use the shared literal guards. Naive dates retain only
the calendar date. Real UTC offsets and fractional seconds remain verbatim.
Unverified photo hosts and vehicle/parts links are null.

Each yard independently enforces its accepted floor, at most 10% rejected donors
and at most 25% duplicate donors. Raw repeated-stock occurrences also have a 25%
guard. Production source validation requires at least 2,498 accepted vehicles,
the unchanged source rejection/duplicate limits and at least 50% of the previous
accepted source count. A failure preserves prior accepted inventory.

## Transport and durable evidence

Requests are serial across chunks. A shared semaphore holds the permit through
headers, bounded complete body processing and a further 1.6-second pause,
including failures. Current Firefox headers are used, with no automatic retries
or redirect following. Every response requires exact HTTP 200, expected MIME,
the verified URL, no content-range and valid complete UTF-8. One 20-second
signal covers headers and body and propagates interruption.

Chunks default to eight controls, allow at most sixteen, and have a three-minute
deadline. No new control starts after 150 seconds. Cumulative limits are 2,048
requests and 32 MiB of response bodies. The checkpoint wire limit is 16 MiB,
checked before JSON parsing and persistence. Capacity errors preserve the last
validated checkpoint and require inspection or requalification.

The versioned cursor stores a contiguous raw-response prefix for each tenant,
plus scope and checksum. Resume re-executes the finite protocol over every saved
response, independently rechecking selectors, full records, ownership, coverage,
closing controls and completed-yard quality. Earlier yards cannot be skipped.
Checksums detect accidental corruption, not an untrusted actor who can rewrite
both evidence and checksum. No provider transport is imported into Workflow code.

Paused chunks emit zero count/accounting, no rejected presence and no callbacks.
Callback failure returns no advanced checkpoint. Complete evidence for every
configured yard is required before durable source acceptance.

## Offline checks and read-only soak

`vinplus-test-fixtures/census.json.gz` replays 923 response bodies. The original
five yards contain 586 captured opening/closing responses. Killeen adds 170
captured opening responses and 167 simulated closing responses that reuse the
captured bodies. These simulated reads test closure, checkpoints and warning
propagation; they do not claim a live closing verification. Production still
requires fresh closing reads. Provenance and deficit counts are recorded in
`vinplus-test-fixtures/killeen-replay.json`.

Qualification accepted 710/720 donors at Pocatello, 1,406/1,423 at Ryan's,
1,082/1,084 at Sterling Heights, 464/490 at YourPart, 1,558/1,575 at Killeen and
1,085/1,097 at Lubbock: 6,305 accepted, including 38 pre-1981 serials, and 84
rejected. Check-digit validation adds 43 rejected donors to the frozen census:
3 at Pocatello, 0 at Ryan's, 1 at Sterling Heights, 15 at YourPart, 14 at Killeen
and 10 at Lubbock. YourPart's total rejection rate is 26/490 (5.3061%) and
Killeen's is 17/1,575 (1.0794%); all yards remain below 10% and above their
accepted floors. Ryan's 1,428 raw backend rows include five repeated stocks.
Its invalid-check-digit VIN `1C4NJCEB4HD189960` belongs to conflicting stock
`STK229812`, which was already rejected without asserted VIN presence. Thus
44 frozen VINs fail the check digit, but only 43 add donor rejections.
All six yards had zero distinct-stock VIN duplicates.
`qualification.json.gz` retains the cap example, original Killeen opening
prefix, offset-bearing Lubbock sample and Census responses. Tests mock transport
and never touch the network.

```sh
bun test --timeout 15000 src/server/ingestion/vinplus-*.test.ts
bun run soak:sources -- --sources=vinplus --max-pages=2048
```

The soak is read-only. Its driver roundtrips checkpoints, verifies progress and
rejects premature donor accounting. It writes no database, index or feature flag.

## Indy qualification, November 16, 2026

Indy is the seventh tenant, backend yard `indy_u_pull_it`, with six-digit Crush
stocks and one physical Indianapolis yard. Its official address has a unique
Census Public_AR_Current match. The complete live opening/closing protocol uses
154 serial requests and accounts for all 1,333 advertised donors: 1,316 accepted,
17 rejected, zero duplicates and zero unreachable rows. Modern VINs pass check
digits; one eligible pre-1981 serial is accepted. Indy retains its 400-donor floor. Other current floors use approximately
one third of each accepted census. The 50% drift protection remains unchanged.

`vinplusCensus()` appends the original `indy.json.gz` responses to the prior
six-yard replay, for 1,077 total response bodies. Seven-yard replay accepts
7,621 vehicles and rejects 101. `indy-qualification.json.gz` retains original
operator/address evidence; `indy-requests.json` records the live request ledger.
See [the expansion receipt](provider-coverage-ario-vinplus-tpi.md) for per-yard
counts, requests and qualification limits. No source enablement is included.
