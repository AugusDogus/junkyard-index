# Midway U Pull ingestion

See the current [source flags and census floors](provider-coverage-go-live.md).

`midway` enumerates two native self-service donor catalogs. It admits native
VINs (or eligible pre-1981 serials), year, make and model. Color, stock, photos,
inventory date and yard position are optional, with absent or unverified values
stored as null.

| Native selector | Physical yard                                                   | Verified snapshot        |
| --------------- | --------------------------------------------------------------- | ------------------------ |
| `MO38`          | Muncie, 6345 Kansas Ave, Kansas City KS 66111, 913-287-6185     | 419 accepted, 0 rejected |
| `MO09`          | Liberty, 1101 Old State Hwy 210, Liberty MO 64068, 816-781-4886 | 344 accepted, 0 rejected |

The official [homepage](https://midwayupull.com/) verifies each physical yard,
phone and self-service scope. Native selector codes determine ownership. The
shared `mo06` image-storage prefix does not determine a vehicle's physical yard.
Coordinates come from the separately hash-verified AutoSalvageYards map entries
matching these native yard names and cities. Aesop full-service sites remain outside this connector's scope. Tulsa is admitted by the November 15 make traversal below. Tulsa's later required-field check remains
unqualified because its broad native view is incomplete, as recorded below.

## Tulsa completeness check, November 12

The published `OO95` selector identifies Tulsa U-Pull. Its UI-derived unfiltered
table returned 500 donors, with 486 unique required-identity candidates and 14
identity rejections. A published `search=2000` control returned 33 donors,
including 20 stock/VIN pairs absent from that broad table. For example,
`STK031020`, VIN `1FMZU75E5YZA71545`, appears only in the filtered control.
The subsequent unfiltered bookend reproduced all 500 original row fields.
All three requests returned HTTP 200 without redirects or retries.

A subsequent published grid-view control also returned HTTP 200. Its 500 cards
contain exactly the same stock set as the broad table and publish no continuation
link. This view switch does not establish complete inventory. The separate
`grid-scope-review.json` receipt preserves its body hash and comparison.

This proves that the 500-row broad view is incomplete. It does not establish
an exhaustive partition scheme or a current source total. Tulsa is not admitted,
and no application source or cursor scope was expanded. The captured Muncie
and Liberty admissions were below 500 rows. The local parser now rejects views
at or above the observed 500-row boundary before inventory callbacks. This
guard blocks unverified completeness; it does not implement full traversal.

Three new regressions failed before the guard. The four added boundary and
callback checks now pass, as do all 175 affected tests, lint and typecheck.
An offline connector replay still emits the exact 763 previously qualified
donors across the two existing yards, including a serialized resume and accepted
terminal source validation. No live sibling-yard crawl was repeated.

Exact captures, accounting and bookend proof are under
`.scratchpad/coverage/parent-midway-tulsa/`. Independent saved-only evidence is
in `parallel-il-mo-ks/midway-tulsa-saved-scope-review/cap-counterexample-saved-analysis.json`
under the coverage directory. No atomic provider snapshot is claimed.

## Existing two-yard connector

The native inventory selector publishes these unfiltered, yard-specific table
views:

- [Muncie](https://midwayupull.com/inventory/ANY/ANY/?k=1&id=MO38&view=table)
- [Liberty](https://midwayupull.com/inventory/ANY/ANY/?k=1&id=MO09&view=table)

The page identifies donor inventory with the statement, "Some vehicles may not
show parts available if we haven't parted them out yet." Both snapshots contain
complete server-rendered table bodies. Bootstrap Table 1.21.4 paginates those
rows locally. `ANY` location selection, mismatched native selectors or form IDs,
nonempty searches, remote pagination, changed headings, incomplete rows and
truncated documents fail the snapshot. Empty catalogs also fail. No individual
part's stock status is used as donor-availability evidence.

One durable page unit validates and emits one complete yard. Muncie precedes
Liberty. A paused checkpoint retains every valid observed VIN, including rejected
donors, plus known stock identities. Duplicate identities within or across yards
fail before that yard's callbacks. Every yard must retain at least one accepted
donor and at most 10% required-field rejection. Rejected valid VINs provide
presence evidence only. Source-level minimum inventory, drift and reconciliation
guards remain centrally enforced.

Requests use bounded UTF-8 bodies (4 MiB), exact HTTP 200 HTML, no content-range,
no redirects, 25-second request/body limits and no automatic retries. One request
gate covers every homepage and catalog GET. The default connector permits one
request per 1.6 seconds and a two-minute chunk budget. It makes no donor-photo,
inquiry, cart, login or production request. Verified native `main-vehicle-img` URLs are preserved from the inline table; logos and unverified hosts remain null. The shared `mo06` storage prefix does not determine yard attribution. No photo network
request is required to admit a donor.

Run semantic tests with `bun test src/server/ingestion/midway`. The count-only
`soakMidwayInventory` harness accepts an injected chunk runner and never imports
database or search-index writers. The complete two-yard saved replay uses the
native body files under
`.scratchpad/coverage/parallel-il-mo-ks/next-pass/evidence/requal-midway-*`.
Its qualification audit is under that lane's
`requalification/evidence/midway-*-current-enumeration.json`. The snapshots have
763 valid unique VINs, no cross-yard overlap and zero required-field rejection.
Research qualification and local replay do not authorize production enablement.

## Tulsa complete make qualification, November 15

Tulsa (`OO95`) qualifies locally and joins the existing Muncie and Liberty
traversal. The source runs unless its pause flag serves false.

The native broad table is capped at 500. The complete traversal visits all
59 distinct published makes once, including the menu's duplicated NISSAN value.
Every partition contains fewer than 500 rows. Scoped native empty responses
prove their make, ANY model and Tulsa yard with their published controls.
An inline Cloudflare JSD script in these normal HTTP 200 pages is not a block.

The union contains 1,083 donors: 1,064 accepted, 19 rejected (1.75%), and no
duplicate stocks or VINs. Both broad 500-row witnesses are fully covered and
the fresh closing witness is unchanged. Quality and duplicate checks finish
before the Tulsa batch or yard callbacks. Rejected valid VINs remain presence
evidence. A five-minute request budget accommodates the complete make crawl.

The native home page publishes 13802 E Apache St, Tulsa OK 74116 and
918-234-4444. The US Census geocoder matches that exact address at
36.191506616229, -95.823681530963. This is street-range interpolation over
12900-14198 E Apache St, not a rooftop coordinate.

This follow-up made 61 provider requests (home, 59 make pages and one closing
broad page) and one Census request. All returned HTTP 200 using production
headers and pacing. The earlier saved opening was reused.

Evidence: `.scratchpad/provider-coverage/nov14-provider-goal/midway-expansion/`.
Admission: `midway-tulsa-local-admission.json` in its parent directory.
`midway-test-fixtures/tulsa-census.json.gz` stores complete response bodies,
prior-yard identities and the Census response. `midway-expansion.test.ts`
replays the actual production collector, all 59 controls, explicit empty pages,
closing, yard link targets and exact accounting without live requests.
