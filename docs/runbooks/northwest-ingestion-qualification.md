# Northwest Auto Parts qualification

See the current [source flags and census floors](provider-coverage-go-live.md).

Northwest Auto Parts, Anchorage AK, qualifies locally under the owner's maximum
1% unrecovered advertised-donor rule. The source is wired and enabled unless its pause flag serves false.
There are no database, index or rollout writes.

The saved complete census covers all 36 makes and 334 models: 6,934 occurrences,
6,688 accepted donors, 246 rejects (3.55%), and zero benign duplicates. Every
occurrence in the 17 conflicting VIN groups is quarantined, including 34 rows.
The 10% rejection guard and the previously selected 2,229-donor floor remain.

## Transport and traversal

The Central-style production request to ACURA MDX returned real HTTP 200 data.
The Northwest client uses the same GET profile, `Mozilla/5.0`, `Accept: text/html`,
manual redirects, combined 20-second deadline, 2 MiB response limit, and
1.6-second post-completion gate. No alternate headers or browser workaround was
needed then. The earlier raw-request 403 is retained as historical evidence.

Since 2026-11-18 Cloudflare has refused every native request from Vercel with
HTTP 403. Production chunks open one Kernel browser (stealth with CAPTCHA
solver, headless, direct egress; see [browser providers](browser-providers.md)).
Hyperbrowser (stealth, accepted cookies, `us-west`, no proxy, no CAPTCHA
solving) remains the one-line fallback. The first document of a chunk
loads by page navigation; later documents use same-origin in-page `fetch()`
with manual redirects. The browser supplies its own headers; status, URL, MIME,
range, size and UTF-8 checks are unchanged.

A chunk reads all of its pages (up to eight) in one URG host turn. It takes the
provider's [session lease](hyperbrowser-sessions.md) first, never inside the
turn, then waits for the turn without a session. The session opens with the
first request inside the turn, inside its host slot, and is stopped when the
chunk ends, so the session never waits in the URG queue. Each request still
takes its host slot, with the 3.5-second URG gap before it and the 1.6-second
gate after it. A page after the first starts only if it can finish by the
chunk's turn horizon. The turn holds one of the URG group's places for the whole
chunk, typically about a minute, instead of one place per page. While the chunk
waits for its turn it holds the session lease without a session, which is not
billed but keeps the provider's other sources waiting.

The page routes every request, which disables the browser HTTP cache. It loads
only the chunk's own documents (the main-frame navigation and the in-page
`fetch()` being read) and Cloudflare's `/cdn-cgi/` resources, which Cloudflare's
edge serves without reaching the site. Every other request, including the page's
scripts, stylesheets, XHR, frames, images and fonts, is aborted, so every request
that reaches the site is a document read inside the host slot and the
1.6-second gate. Pacing and the request ceiling are unchanged.

Runtime follows the published make directory, every make, and every model,
without deriving model URLs. It validates AK01 ownership, native physical address,
complete HTML, literal headings, card boundaries, VIN/YMM, inquiries and donor
links. New continuation controls fail closed for inspection. All native identity
conflicts share the existing connected quarantine rules. No inventory is emitted
until the closing root, make directory and model re-reads match. The 1% unrecovered
rule still applies. Checkpoints retain the complete native claims and validate
contiguous graph prefixes, request counts, context and hashes.

Model pages follow the shared [model census](model-census.md) with
`reuse: "never"`: every model page is read on every run, plus gap full reads,
short-page confirmation, the badge floor and the 97% replay floor. Badge-only
reuse was removed: a donor crushed and another placed under the same model
keeps the badge, so a page carried on its badge would hide both changes.
Northwest specifics:

- Every run reads the root, the make directory, all 36 make menus and all 334
  model pages. A page's read reason is `new`, `count` or `short` when one
  applies and `daily` otherwise; after a missed, failed or rejected run every
  page reads as `gap`. Nothing is carried. Closing re-reads the root, the make
  directory and every model page whose cards differ from its badge or fall
  below its expected cards, so Northwest confirms short pages. Make menus are
  not re-read at closing; a menu change shows up as a badge change in the next
  run's menus.
- Badge floor: 95% (`NORTHWEST_MINIMUM_BADGE_COVERAGE`). The saved census covers
  99.63% (6,934 of 6,960 badge cards). Emptying any one of six key-hash groups
  of its models (about 56 models each) leaves 76.0% to 88.9%. Cutting one group
  to one card per model leaves 77.0% to 89.6% of badges and 77.3% to 90.0% of
  last accepted cards, so both floors fail it.
- Requests per day: every run is a full read, 380 requests on the saved census:
  root, directory, 36 menus and 334 models, then closing root, directory and
  the six models whose cards differ from their badges, plus a closing re-read
  for any other page below its expected cards. Cold and gap runs cost the same
  and differ only in read reasons and in confirming no short page.
- Census contract `incremental-model-census-v3`; cursor cap 16 MiB.

The Nov 14 qualification follow-up made 17 provider requests: 14 HTML pages,
one published JavaScript resource and two native year-search AJAX calls. All
returned 200. One additional US Census request supplied an exact-address
street-range match for 5700 Camelot Drive, Anchorage AK 99504: 61.220492673939,
-149.775910317066. The range is 5500-5798 Camelot Drive, not a rooftop point.

## Unrecovered donor warnings

Fresh raw model pages and their native badges confirm these saved gaps:

| Make      | Native model                              | Advertised | Found | Unrecovered |
| --------- | ----------------------------------------- | ---------: | ----: | ----------: |
| AUDI      | AUDI A4                                   |         11 |    10 |           1 |
| CHEVROLET | CHEVROLET 1500 PICKUP                     |         19 |    18 |           1 |
| CHEVROLET | CHEVROLET PASS/ (`CHEVROLET_PASS.` route) |          1 |     0 |           1 |
| CHRYSLER  | TOWN & COUNTRY                            |         21 |     0 |          21 |
| NISSAN    | TITAN                                     |         16 |    15 |           1 |
| TOYOTA    | TUNDRA                                    |        107 |   106 |           1 |
| Total     |                                           |        175 |   149 |          26 |

The exact unrecovered total is **26 / 6,934 observed = 0.374964%**, below 1%.
The 149 cars actually found within those models are not counted as missing.
Eight additional make/model-sum contradictions advertise fewer cars at make
level, so they add zero missing cars: Chevrolet 1,461 versus 1,464, Dodge 885
versus 887, Ford 1,327 versus 1,329, GMC 458 versus 461, Honda 122 versus 123,
Jeep 463 versus 465, Subaru 466 versus 468, Toyota 530 versus 531. All fourteen
contradictions remain explicit connector warnings. Future positive make deficits
are counted only beyond the already counted model deficits.

For Town & Country and Chevrolet PASS/, inspection found no donor pagination.
The donor text filter only hides already loaded cards. The native year-search
script searches individual parts, rather than filtering the donor catalog. Its
2014 Chrysler model API returns the same `TOWN_-and_COUNTRY` slug as the empty
published donor page. Chevrolet's 2014 model API offers no PASS/ alternate.
No additional donor route was found and no donor identity was inferred from a
part search. All responses and the native script are saved.

## Offline verification and evidence

`northwest-expansion.test.ts` traverses all 334 models through the real client,
serializes each checkpoint, and verifies 380 cold-census replay requests (the
original qualification replay made 418 under the older closing), terminal counts,
Census geography, pause flags and destinations. It tests the 1% boundary,
missing models, changed checkpoints, new continuation, wrong supplier, truncation
and HTTP refusals without emissions.

The complete historical census consists of **browser DOM observations**, not raw
HTTP captures. The fixture retains original row HTML, literal links and inquiry
claims, with reconstructed document/card envelopes explicitly identified in the
test. Fourteen current real HTTP HTML witnesses independently exercise the raw
parser and request profile. This qualification does not claim a new live
334-model census.

- Original census and closing evidence:
  `.scratchpad/coverage/parent-refills-nov14y/northwest_continue/`.
- Current HTTP, native JavaScript, AJAX and Census evidence:
  `.scratchpad/provider-coverage/nov14-provider-goal/northwest-expansion/`.
- Offline fixture: `src/server/ingestion/northwest-test-fixtures/qualified-census.json.gz`.
- Admission: `.scratchpad/provider-coverage/nov14-provider-goal/northwest-anchorage-local-admission.json`.

Run `bun test --timeout 15000 src/server/ingestion/northwest-*.test.ts` offline.
An authorized read-only soak is available through `soak:sources -- --sources=northwest`.
