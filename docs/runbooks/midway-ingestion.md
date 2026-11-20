# Midway U Pull ingestion

See the current [source flags and census floors](provider-coverage-go-live.md).

`midway` enumerates three native self-service donor catalogs (Muncie, Liberty
and Tulsa), each by make traversal. See "Every yard by make, November 19" below;
earlier sections that describe broad-table admission for Muncie and Liberty are
history. It admits native VINs (or eligible pre-1981 serials), year, make and
model. Color, stock, photos, inventory date and yard position are optional, with
absent or unverified values stored as null.

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

## Every yard by make, November 19

The Muncie and Liberty broad tables are not complete. Like Tulsa's, they are
newest-first views with a cap, but the cap is lower and varies by day: Muncie
returned 415 rows on November 18 and 400 on November 19, and Liberty 333. The
cap cuts mid-date. A same-day Muncie `search=2026-09-1` table listed 35 donors
absent from the 400-row broad table. A Liberty `search=2026-09` table listed
209 September donors, 196 of them absent from production, and the Liberty JEEP
make page lists 26 Jeeps, 12 absent from production. `pagenum` is ignored on
plugin v1.8, so a make partition is the only way past the cap.

The connector now treats every broad table as a capped witness and never
admits one. Each yard runs the Tulsa traversal: an opening broad witness, one
page per native make control from the opening's make menu, then a closing
broad witness that must equal the opening. Every witness row must appear on
some make page. A make page is refused at 500 rows, and also when it has at
least as many rows as the opening broad table, because a broad table that
stopped at N rows proves the cap can be as low as N. Yard identity, duplicate
stock/VIN checks across yards, explicit empty makes, the per-yard 10%
rejection limit and nonzero accepted guard, per-make checkpoints, the soft
stop and shared host turns are unchanged.

The checkpoint phases are now `opening` and `census`, both carrying the yard
code. Older `yard` and `tulsa` checkpoints fail validation, so a run saved
before this change fails clearly and the next run starts fresh rather than
resuming a yard admitted from a truncated table.

Cost: about 3 x (opening + 59 makes + closing) plus one home page per chunk,
roughly 190 requests per daily run instead of 67 when the shared host is
uncontended. Under 07:00 shared-host contention (turns of about 2.5 minutes) a
chunk gets through only about one native page after its home check, so a run
can take up to about twice that, roughly 370 requests and 7 to 8 hours of
turns. The longer Muncie and Liberty opening-to-closing windows make a closing
witness mismatch more likely, and the Cloudflare edge cache (`max-age=3600`)
can serve the same render to both witnesses and hide drift. A daily
newest-first window with a weekly census would be cheaper, but the durable
pipeline has no scoped departure mode, so a window run would mark every unseen
donor departed.

`midway-broad-cap.test.ts` replays the November 19 captures under
`midway-test-fixtures/`: the 400-row Muncie broad table is never admitted, and
make pages built from the broad and date-search rows recover the 35 missing
Muncie donors.
