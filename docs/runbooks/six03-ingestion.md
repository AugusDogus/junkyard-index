# 603 Auto Salvage ingestion

See the current [source flags and census floors](provider-coverage-go-live.md).

Source `six03` is the native donor catalog at
<https://603autosalvage.com/parts-vehicles/>. Yard `plaistow` is 603 Auto
Salvage, 233 Main St, Plaistow, NH 03865. The named business marker is
42.8545693, -71.1094333. Native Visit Us, contact map and LocalBusiness address
support that yard. The generic Organization claim of 5 Westville Road and
42.8365, -71.0948 remains separately recorded as conflicting metadata. It does
not establish another yard.

## Native graph and identity

The inspected custom grid contains 1,033 unique owned donor destinations.
Its script clears the WordPress main and moves `#pv-custom-archive` into it.
The first 24 cards and subsequent groups of 12 already exist in that complete
document. See More Vehicles performs a local reveal. Exactly one WordPress
page-two head link and the matching Next anchor are displaced controls, not
another inventory frontier. A changed reveal contract, extra head continuation,
query pagination, hidden card or unlisted donor stops traversal.

The opening catalog includes ten native article excerpts with explicit Unit
Data fields. The catalog fixes the roster; donor articles come from the site's
public WordPress REST collection,
`/wp-json/wp/v2/parts-vehicles?per_page=100&page=N&orderby=id&order=desc&_fields=id,slug,link,title,content`.
Each item's `content.rendered` is the donor page's article and `title.rendered`
its `entry-title`, so one parser reads both. In the Nov 2026 census all 1,024
donors with a saved donor page parse to identical fields, headings and photo,
and the ten excerpts match their articles' Unit Data. Eleven REST pages replace
1,023 donor-page GETs and their per-session homepage loads.

The REST census must equal the catalog roster exactly. Every page must declare
the roster's donor count in `X-WP-Total` and `X-WP-TotalPages`, every page but
the last must hold 100 donors, ids must descend strictly within and across
pages, and every item must be a listed donor whose `link` matches its `slug`.
A donor added or removed between page reads repeats or skips an id and stops
the census. Items are strictly typed (`id`, `slug`, `link`, `title.rendered`,
`content.rendered`, unprotected content); any other shape stops the census.
No URL is synthesized from YMM, VIN or stock. It requests no donor pages,
images, components, search forms, maps, WordPress page two or returned-link
expansions.

Required identity comes from the designated Unit Data `VIN` and
`Year / Make / Model`, plus the primary sibling `Vehicle Record` H1. Remove
the year and exactly the first recognized native make prefix. Keep all
remaining model words, case, trim and punctuation. For example:

| Unit Data                   | Canonical make | Canonical model |
| --------------------------- | -------------- | --------------- |
| `2005 Infiniti Infiniti FX` | Infiniti       | Infiniti FX     |
| `2007 Jeep Jeep Commander`  | Jeep           | Jeep Commander  |
| `2020 Honda Civic`          | Honda          | Civic           |
| `2006 Land Rover LR3`       | Land Rover     | LR3             |

The outer `entry-title` is a decorated article title. Retain its literal native
claim and validate year/make; color and trim decorations do not become another
structured model. The primary H1 must agree with Unit Data. The native Frontier
SV versus SV 4×4 contradiction remains a required rejection. Do not decode VINs,
clean model words, derive identity from route tokens or select a preferred
structured variant.

Before duplicate selection, quarantine every occurrence in a VIN group with
distinct owned donor destinations, a destination with multiple valid VINs, or
conflicting structured YMM. All valid rejected VINs supply presence only.
An invalid `Not Available` VIN claim does not invent a second valid VIN.
Missing/invalid VINs remain raw required rejections, including stock `TESTPY`.

Optional stock, engine, transmission, exterior color, trim and donor image do
not gate identity. Missing, malformed, oversized or conflicting optional values
produce null metadata. Generic yard images
and logos are not donor photos. No per-row current-parts, residence, date or
optional-field requirement is imposed on this native own-yard catalog.

## Bounded execution

`streamSix03Inventory` uses serial requests with at least 1.6 seconds after
each completion, including failure. A request owns its transport and body
lifetime. Interruption, deadline, refusal and body overflow abort/cancel and
release the reader before returning. There are no retries or redirect follows.

| Bound                          | Limit                  |
| ------------------------------ | ---------------------- |
| Combined request/body deadline | 20 seconds             |
| Complete UTF-8 HTML body       | 2 MiB                  |
| Complete UTF-8 REST JSON body  | 4 MiB                  |
| Native GETs per chunk          | 1 to 18                |
| Chunk lifetime                 | 3 minutes              |
| Last GET start                 | 25 s before chunk end  |
| Serialized cursor              | 1 MiB                  |
| Native roster                  | At most 1,200 controls |
| Total GET units                | At most 18             |

A census is contact, catalog, one GET per REST page, then four closing reads:
17 GETs for 1,033 donors, normally one chunk and one browser session. A slow
site pauses the chunk at a checkpoint instead of starting a GET it cannot
finish.

The cursor strictly validates source, version, scope, checksum, native projection
fingerprints, REST page ids and roster membership, phase and request accounting. It stores
compact native claims, not raw HTML or canonical vehicle arrays. Serialize with
`Six03Cursor.serialize` and restore with `Six03Cursor.parse`.

Closing controls recheck contact identity, ordered roster/local reveal graph,
embedded observations, and the first and last REST pages' ids and donor
projections. Nothing is
emitted before those controls and complete quality checks pass: no vehicles,
yard callback, rejected VIN presence or accounting. A failure leaves the caller's
last accepted checkpoint and prior inventory intact. Resume that checkpoint
after diagnosis, or restart when native membership changed.

The accepted inventory floor is 324 vehicles. Raw accounting is
`U + D + R`, without excluded donors. Maximum rejection and duplicate ratios
remain 10% and 25%. `scripts/soak-six03.ts` only drives bounded chunks and
aggregates count/discard results; it does not write staging or admit a source.
Registration, reconciliation and enablement belong to the shared pipeline.

## Saved qualification and verification

The completed census has 1,033 native donors, 1,025 raw valid VIN presences,
973 accepted vehicles, 0 duplicate extras and 60 required rejections (5.808325%).
Twenty-six quarantined VIN groups cover 52 rejected raw donors. The remaining
eight rejects have no valid VIN. Twenty-five VIN groups have multiple owned
destinations. No destination has multiple valid VINs in this saved census.
All guards pass without model cleanup or preferred winners.

Saved evidence is under
`.scratchpad/coverage/parallel-me-nh-vt/603-finite-census11/`.
The terminal manifest SHA256 is
`f26fa5b9bc6df9f56dfffdce0b0dd57407a555ee878f54304dbdd9e1938fe65b`.
Independent all-occurrence accounting is under
`.scratchpad/coverage/parallel-ma-ct-ri/603-independent-review01/`.
Independent physical review is under
`.scratchpad/coverage/parallel-wa-or-id/603-nh-physical261-review01/`.

Checked-in compressed fixtures retain the complete native catalog/contact,
the exact native main/title/canonical/phone fragments of 1,023 donor bodies,
a complete Jeep detail example, and `rest-census.json.br`: the complete bodies
and census headers of the eleven REST pages read on 2026-11-19. `six03-test-fixtures/manifest.json` pins
each full source body and retained fragment. The saved-only generator
`six03-test-fixtures/build-fixtures.py` preserves source CRLF bytes. Tests do
not depend on ignored scratch files or network access.

The independent Python/lxml oracle contains all 973 vehicles and all 25 fields
(24,325 values). It does not import the app parser or transform. Oracle SHA256:
`45f05e4469928cfd2e02f5bda8fea472c96430aacb81fb5bd1f8dd2194fb20cb`.
The full connector replay reads the REST census in one 17-GET chunk and
compares every canonical value. The only difference from the donor-page oracle
is three excerpt donors (Matrix, Jeep, Flex) that now carry their article's
main photo.

```sh
bun test src/server/ingestion/six03-*.test.ts
bunx oxlint src/server/ingestion/six03-*.ts scripts/soak-six03.ts
bun run typecheck
```
