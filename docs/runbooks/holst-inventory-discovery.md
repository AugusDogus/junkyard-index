# Holst inventory discovery, November 17, 2026

Holst Truck Parts remains **blocked, retained, zero admitted vehicles**. This
investigation follows [PR #180](https://github.com/AugusDogus/junkyard-index/pull/180)
and its [rate-limit evidence](provider-coverage-ario-vinplus-tpi.md#holst-request-investigation-november-17).
No source registration, floor, flag, production data or deployment changes.

## Platform and larger rosters

The inspected Holst inventory is **Truck Parts Inventory (TPI), not Hollander
Stores**. Its server-rendered `/trucks/` page loads `wp-content/plugins/tpi-portal`
scripts and photographs from `images.truckpartsinventory.com/trucks/22216/`.
The footer names Truck Parts Solutions. No Hollander tenant link was found in
these responses. This does not prove Holst has no separate unpublished tenant.

Our Hollander client posts `hdnChangeDisplay=card` to each configured tenant's
`VehicleDealerSearch` route. That returns the entire card roster in one request;
an independent closing request makes two roster requests per tenant. The fallback
list view uses `hdnChangeDisplay=list`, `?page=N` and 20 rows, with missing native
makes. These are different endpoints and templates from Holst's TPI portal.
Applying Hollander's card parameter to Holst has no supporting evidence.

Holst advertises **2,374 Salvage rows, 25 per page, 95 pages**. Its page-size
selector supports only 10, 15 and 25. The saved `filters.js` navigates with
`per_page`; the fresh `per_page=100` response still has 25 cards and two matching
`1-25 of 2374` bounds, with last-page links to 95. PR #180's `per_page=2500`
probe has the same bound. This is a portal page-size restriction, not 95
Hollander categories or a large Hollander response hitting our transport cap.

The three TPI scripts preserved in #180 expose navigation, lazy images and a
local-storage cart. The public WordPress REST directory has no inventory route.
This follow-up followed the native theme module and its `navigation.js` import,
plus the scroll script: menu interactions and intersection animations only.
No inventory fetch/XHR, bulk export or search-all route was exposed by the
inspected application scripts. No private endpoint or guessed export was used.
The TPI marketplace homepage returned HTTP 403; investigation stopped there.
An undiscovered provider feed remains possible.

## Other public channels

- **HeavyTruckParts:** the vendor directory and store identify Holst Truck Parts,
  supplier `428606`, store `1`, phone `208-522-1788`, street
  `10209 N YELLOWSTONE`, Ucon ID 83454. The street and phone agree with Holst's own footer,
  which uses Idaho Falls ID 83401. Its store publishes component categories,
  but no bounded `Complete Vehicle` count. The supplier/store-scoped
  `/search/Any/Any/Complete-Vehicle?fltpc=428606&store=1` response explicitly says
  **"Sorry, no matches were found"**. Component listings cannot substitute for
  a whole-donor census. No marketplace ownership or postal-code guess is admitted.
- **BigTruckPage:** its unfiltered seller directory reports four matched
  sellers, page 1/1: Central Motor, Complete Truck Repair, Misiuk Motors and
  Route 66 Trading Company. No Holst seller is published in that directory.
- **Sitemap:** `robots.txt` points to `/wp-sitemap.xml`, which lists only
  `/wp-sitemap-posts-page-1.xml`. Its 18 URLs are ordinary site pages, including
  the generic `/truck-description/` page, with no `?truck=` donor destinations.
  These page modification dates do not establish inventory freshness.
- **Own-site feed:** the linked `/feed/` RSS channel has zero `<item>` entries.
  It is not an inventory feed.

Neither configured marketplace currently credits ID. HeavyTruckParts covers
MA, KY, TN, GA, FL and AZ, with separate Dutchers NY and C&S SD sources;
BigTruckPage covers Misiuk in MO. A qualifying Holst marketplace catalog could
add one credit for that marketplace in ID, not one per listed yard. The current
change adds **zero ID credits and zero vehicles**.

The native `sort=Newest` probe still returns the same first 25 donor identities
as the page-size probe. Neither it nor the first linked detail, truck `196848`,
publishes an arrival date. That detail binds `Now Wrecking`, 2006 GMC C4500,
VIN `1GDE4C3206F434509` and lot `111826` to the native destination. A lot number
or increasing record ID is not a verified date. The newest vehicle within about
60 days, complete accepted census, physical truck scope and ownership controls
remain unproven. A valid sampled VIN cannot establish admission.

## Conditional pacing design, not enabled

The unfiltered opening/closing protocol still costs **190 roster reads per
complete run**, before ownership/freshness controls and retries. At ten seconds
between completed responses, spacing alone exceeds 31 minutes; #180 already
proved that spacing can receive HTTP 429. It is not a safe daily rate contract.

Simply carrying page ordinals between daily runs is unsafe: insertions and
deletions shift offsets. Unlike URG's independent model buckets, yesterday's
page 20 is not a stable inventory partition. No partial opening traversal may
become an accepted census or retire missing donors.

If Holst confirms that no better feed exists and supplies a suitable rate
contract, a candidate design is:

1. Persist one origin-wide serial lease, request-attempt ledger, daily budget,
   last completed time and `retryAt` across chunks, restarts and daily runs.
   Use a normal browser User-Agent. Tentatively spread attempts at least 30
   minutes after the preceding response, with at most **40 attempts per UTC
   day**, including controls, failures and retries. This is a proposed ceiling,
   not permission or a measured safe rate.
2. On the first 429, stop the run. Persist the unchanged request and the full
   Retry-After deadline (delta seconds or HTTP date). Resume no earlier than
   the maximum of that deadline, the pacing deadline and the next daily budget
   window. Missing or invalid Retry-After blocks automatic resumption. Do not
   visit another route, session or hostname to evade the cooldown.
3. Use the 39 literal native make facets as candidate stable buckets, after
   verifying their traversal and partition coverage. Their badges sum exactly
   to 2,374. At 25 rows per page they project **124 pages per pass, 248 opening
   and closing reads**, before independent controls. Bootstrap must capture
   and verify every bucket; partial state is only resumable progress.
4. After an accepted bootstrap, carry only previously accepted complete
   buckets, with their raw identity claims, rejects, exclusions, evidence hashes
   and successful-read timestamps. Read opening/closing ownership and complete
   facet controls daily. Refresh changed/new buckets and scheduled slices;
   confirm removed buckets before retiring them. Apply URG's six-day carry
   eligibility and seven-day age ceiling, never extending age on a failure.
   Rerun VIN check digit, YMM, native link, truck scope, rejection, duplicate,
   drift and floor checks on the combined census before publication.
5. A seven-slice size-balanced illustration costs 36 roster reads on five days
   and 34 on two days. Two daily catalog controls make **38 or 36 requests/day,
   262/week, mean 37.4/day**, before extra ownership/freshness controls, changes,
   age-triggered refreshes and retries. The 40-attempt ceiling leaves little
   headroom. Bootstrap also needs at least seven daily budgets at this size.
   If mandatory reads cannot fit, preserve prior publication and stop; never
   silently exceed the ceiling or publish expired carry-forward evidence.

This is **still too heavy to enable on the available evidence**. Make-scoped
completeness and stable closing remain unqualified. More importantly, no dated,
complete arrivals/change channel has been verified. Equal make counts miss
same-count turnover, and a weekly sweep alone cannot prove the daily arrivals
coverage that URG uses. Without that evidence the correct fallback is a full
census, which defeats the daily budget. A bulk feed or provider-supported
snapshot/change API is the preferred next step, not a faster crawl.

## Capture and offline checks

This investigation made **16 serial provider reads: 10 Holst, four HeavyTruckParts, one
BigTruckPage and one TPI**. All started at least ten seconds after the preceding
completed response. Holst returned no 429 in this small discovery sample;
that does not invalidate #180's 429 or qualify a production rate. There was no
census crawl, cooldown bypass or retry. Requests carried a normal Chrome
User-Agent and no project/owner identification.

Original captures remain under `.scratchpad/holst/`. Committed replay fixtures
are in `src/server/ingestion/holst-test-fixtures/discovery/`, with exact bodies,
SHA-256, byte counts, timestamps, status and Retry-After receipts. The discovery
test checks integrity, spacing, platform/page-size evidence, alternate-channel
results and the request estimate. The existing rate-limit replay remains intact.
