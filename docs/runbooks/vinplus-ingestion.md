# VinPlus app yards

Source `vinplus` is a generic, sequential traversal of independent businesses on
Texn's public VIN+ app. It ships disabled. The boolean
`ingestion-source-vinplus` flag requires explicit rollout. Qualification and a
successful soak do not enable ingestion or authorize production writes.

## Published authority and physical yards

Each tenant has its own canonical yard, stock namespace, address and coordinates.
The public app is the inventory authority and the fallback destination for every
vehicle. No unsupported vehicle permalink is constructed.

| Yard                               | Yard code        | State | Public app slug             | Minimum accepted |
| ---------------------------------- | ---------------- | ----- | --------------------------- | ---------------: |
| U Pull Auto Parts Pocatello        | pocatello        | ID    | u-pull-auto-parts-pocatello |              600 |
| Ryan's Pick-A-Part                 | ryans            | MI    | ryans                       |            1,200 |
| US Auto Supply of Sterling Heights | sterling-heights | MI    | us-auto-supply              |              900 |
| YourPart (SA Recycling)            | hinesville       | GA    | yourpart                    |              400 |
| 195 Used Auto Parts                | killeen          | TX    | 195-used-auto-parts         |            1,300 |
| Pick Ur Part                       | lubbock          | TX    | pick-ur-part                |              850 |

App URLs are `https://vinplus.texnrewards.com/parts/<slug>`. Configuration maps
these to exact backend yard IDs and names. All admitted tenants are single-yard
inventories. The first four use Crush with `STK` plus six digits; Killeen uses five digits. Pick Ur Part
uses YardSmart with numeric 12-digit, `PUP` or `XPUP` stocks and literal
`yardLocation=Lubbock`. Pocatello deliberately permits the
published `hide_vehicle_search=true` configuration. Its unauthenticated public
inventory API qualifies even though its page hides the search form.

Sterling Heights is a different physical yard from source `pontiac`. Ryan's is
its own business in Detroit. YourPart's own site returned HTTP 500 during
qualification; its VinPlus app is the source and destination. Texas was qualified
last; both Killeen and Pick Ur Part qualify. Pickers, including its
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
to rejected VIN presence. Of the reachable rows, 1,572 qualify and three are
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
still fails the source. After exhausting applicable controls, unreachable rows
may total at most 1% of that physical yard's advertised inventory. Exactly 1%
passes with a warning; above 1% fails. Complete yards cannot mask another yard's
deficit. Year overcounts and unadvertised years always fail.

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

Every donor requires `inventoryVin` (including valid pre-1981 serials), usable
published year/make/model and the exact configured physical yard. No VIN-derived
YMM, checksum restriction or identity repair is introduced. Optional color, row,
engine and transmission use the shared literal guards. Naive dates retain only
the calendar date. Real UTC offsets and fractional seconds remain verbatim.
Unverified photo hosts and vehicle/parts links are null.

Each yard independently enforces its accepted floor, at most 10% rejected donors
and at most 25% duplicate donors. Raw repeated-stock occurrences also have a 25%
guard. Production source validation requires at least 5,250 accepted vehicles,
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

Qualification accepted 713/720 donors at Pocatello, 1,406/1,423 at Ryan's,
1,083/1,084 at Sterling Heights, 479/490 at YourPart, 1,572/1,575 at Killeen and
1,095/1,097 at Lubbock. Ryan's 1,428 raw backend rows include five repeated
stocks. All six yards had zero distinct-stock VIN duplicates.
`qualification.json.gz` retains the cap example, original Killeen opening
prefix, offset-bearing Lubbock sample and Census responses. Tests mock transport
and never touch the network.

```sh
bun test --timeout 15000 src/server/ingestion/vinplus-*.test.ts
bun run soak:sources -- --sources=vinplus --max-pages=2048
```

The soak is read-only. Its driver roundtrips checkpoints, verifies progress and
rejects premature donor accounting. It writes no database, index or feature flag.
