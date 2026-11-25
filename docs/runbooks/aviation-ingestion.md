# Aviation Auto Salvage

See the current [source flags and census floors](provider-coverage-go-live.md).

Source-local implementation for one Tucson, Arizona yard. Shared registration,
enablement and admission belong to the parent integration. No production writes,
pushes or pull requests are authorized by this qualification.

The native catalog describes vehicles with parts and vehicles awaiting part-out.
The complete finite known source is the published make/model graph plus native
recent-arrival cards. A recent-arrival feed alone is partial. This qualification
does not claim an upper bound on inventory outside those published surfaces.

## Qualification

The November 12 capture used 459 serial native GETs, all HTTP 200, with at least
1.600155 seconds between starts. The exact historical `/inventory/` route stays
frozen after its branded HTTP 404. Its hidden links never authorize a retry.

There are 43 make controls and 404 model controls. Root badges total 2,481,
model badges total 2,482, and the actual model lists contain 2,524 donor cards.
Cadillac has a root/model badge difference of one. Thirty-two model lists exceed
their advertised counts by 42 cards in total. The cause is unknown. Every card is
retained; badges neither filter donors nor supply the quality denominator.

The two saved root captures contain 60 arrivals each and 61 distinct stable
arrival observations. Eight VINs exist only on this native arrival surface.
One slider card rotated, but both rotated VIN/YMM/destination observations also
exist in the model roster. This does not establish donor inactivity.

The disjoint union has 2,585 observations: 2,326 eligible unique identities,
48 benign duplicate occurrences and 211 required rejected observations. Required
rejection is 8.1625%; benign duplication is 1.8569%. All 29 conflicting VIN groups
are quarantined in full, including matching arrival occurrences. The 211 rejects
include 149 invalid identity observations and 62 additional conflict occurrences.
The explicit native SMART model control and breadcrumb establish model `SMART`
for stock `MM046`; a single-word card title does not require a second `SMART`.

Independent source, physical and source-level canonical gates passed. Native
contact verifies 5231 East Drexel, Tucson, AZ 85706 and 520-574-1700. Coordinates
32.14894, -110.88075 come from the matching ASYD business point, not numeric
coordinates on the official site. The native address-bound map corroborates the
address. A bounded comparison against 213 published and 40 local yards, followed
by an independently verified one-yard Rusty Hook delta, found no
identity/address/phone overlap signal across 213 published and 41 current local
yards. Nearby coordinates alone never
establish an alias or a separate yard.

Evidence is under
`.scratchpad/coverage/parallel-az-nm-nv/saved-opportunity-audit/aviation-hold-scope/census/`.
`final-checkpoint.json` pins the raw capture and disjoint union. Independent
`parallel-ny-nj-de/aviation-source-review/final-disposition.json` pins the gate
results. Application replay and review receipts are separate from that immutable
source packet.

## Runtime contract

The connector follows exact native make/model links. It fetches the official
contact, root arrivals, `/parts/` and the root-configured `/used-parts/makes/`,
then enumerates every literal make and model. It never constructs donor routes
from YMM, fetches hidden inventory links, individual details or images, submits
lookups, follows redirects or retries a failed request.

Model lists use the shared model census with `reuse: "never"`: every run reads
every model list, and no list is carried from an earlier run. Badge-only reuse
was removed because a donor crushed and another placed under the same model
keeps the badge, so a carried list would publish the old donor and miss the new
one. See [the model census rules](model-census.md) for read reasons, gap and
cold full reads, short-page confirmation, both coverage floors and seeding from
the newest accepted publication. Aviation specifics:

- Every run reads contact, root, `/parts/`, `/used-parts/makes/` and all 43
  make menus. Closing re-reads official ownership, the root-configured make
  directory and every model list read this run whose cards differ from its badge
  or fall below its expected cards (`ModelCensus.closingReads`). A re-read that
  differs fails the run, so Aviation confirms short pages at closing. About 32
  lists carry surplus cards above their badge; that surplus stays in their
  expected cards across badge changes. Changed graph/list fingerprints fail
  before emission.
- Badge floor: model cards read this run, each model capped at its own
  badge, must cover at least 95% of today's model badges
  (`AVIATION_MINIMUM_BADGE_COVERAGE`). Every November 12 model list held at
  least its badge (2,482 of 2,482 badge cards on 404 models), and November 19
  badge changes matched card changes. The shared 97% replay floor
  (`MODEL_CENSUS_REPLAY_MINIMUM`) also applies to every model with a last
  accepted page. A sixth of the model lists cut to one card each leaves 82.8%
  to 88.6% of the badges and 82.7% to 88.8% of the 2,524 replayed cards, so
  both floors fail the first such run and nothing publishes.
- Request cost, estimated from the November 12 graph: every run (cold, gap or
  daily) is about 485 GETs (47 opening and make menus, 404 model lists, 2
  closing controls and closing re-reads of any of the about 32 surplus lists
  and short lists that are new, unconfirmed or changed). That stays under the 650 GET run cap.

The saved qualification has nine byte-stable live closing bodies: `/parts/`,
KIA and Pontiac make directories, and the Rio, Tahoe, Mercedes C-Class,
Mercedes GLC-Class, Yukon and Enclave model lists. Its final root has one rolling
arrival rotation. The root-configured `/used-parts/makes/` control was captured
once and matches all 43 published makes. All 404 published model routes were
read, no continuation controls appeared, and this narrower closing set supports
qualification of the complete known finite graph plus arrivals. It does not
prove simultaneous stability of every model list or inventory outside the
published graph. Closing contact, every make directory and the broader model
control set (the historical closing set at qualification, before the
model census) have not all been captured live. Saved replay reuses opening bodies
for those added controls; a future authorized live run must execute them.

Chunks contain at most eight serial GETs and have a three-minute deadline.
Production transport waits 1.6 seconds after complete body consumption on both
success and failure, including across chunk boundaries. Runs stop at 650 GETs.
Each complete UTF-8 response is bounded to 4 MiB. The typed checkpoint is bounded
to 4 MiB (`AVIATION_MAX_CURSOR_BYTES`: room for the previous census plus this
run's pages), 64 makes, 512 models and 10,000 model rows. Exceeding a bound fails
without accepting an advanced checkpoint.

The cursor retains lossless native field tuples, published controls, semantic
page hashes and a checksummed contiguous traversal prefix. It contains no HTML
or materialized canonical vehicle array. Checksums detect internal corruption;
they are not authentication. Whole-source VIN/YMM and destination collisions
are classified before the first callback. Paused chunks emit zero vehicles and
zero accounting. Completion supplies disjoint totals and independently valid
rejected VINs as presence evidence only. Callback failure yields no completed
checkpoint.

`AviationCursor.parse` enforces the 4 MiB UTF-8 wire bound before JSON decoding,
then validates the strict source-tagged schema. `AviationCursor.serialize`
validates the typed checkpoint and produces the same full source-tagged format.
Shared registration must use those codec hooks.

VIN or supported older serial, year/make/model, native destination and verified
yard identity remain required. Color, stock, images, dates and yard position are
optional; invalid or missing values become null. Native stock/year URL bindings
are required traversal evidence. Genuine direct image references must match the
official AZ30 image host and stock path. No image HTTP or freshness rule is added.
Conflicting supplied optional metadata becomes null without rejecting identity.
The existing 10% rejection, 25% duplicate and downstream drift guards apply.
The source-local minimum is 20 eligible donors. Shared enablement must default
off until parent admission and shared-boundary review are complete.

## Validation

```sh
bun test src/server/ingestion/aviation-*.test.ts
bun run typecheck
```

`scripts/soak-aviation.ts` counts and discards caller-owned chunk results. It
serializes every cursor through the production schema and rejects paused
emission or inconsistent terminal status. A saved-response replay uses only
already captured bodies. Additional runtime closing controls without a distinct
live closing body reuse their saved opening body and are explicitly labeled as
replay evidence. Such replay is not a new live crawl or fresh admission.
