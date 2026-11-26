# Joliet U-Pull-It ingestion

See the current [source flags and census floors](provider-coverage-go-live.md).

Status on November 12, 2026: locally qualified from saved public responses with
1,392 accepted unique donors, 14 malformed modern VIN rejects and zero duplicate
VINs. Actual connector replays with 1, 16 and 32 queries per chunk produce
identical canonical output through the shared durable cursor codec. The actual
read-only soak also completes. No production inventory was written; this source
is enabled unless its pause flag serves false.

The source and yard codes are `joliet`. The single self-service yard is at
1014 E. Washington Street, Joliet IL 60433, phone 815-723-3011. The official
[root](https://www.jolietupullit.com/) states that its entire inventory is on
stands and customers bring tools and pull their own parts. The root,
[contact page](https://www.jolietupullit.com/contactus) and unfiltered
[inventory page](https://www.jolietupullit.com/inventory) share the Joliet body
address, phone, navigation and `https://vinplus.texnrewards.com/parts/joliet`
iframe.

The inventory title/heading and root JSON-LD contain copied Littleton content,
including a Colorado address, phone and development URL. These are preserved in
source evidence and excluded as ownership evidence. The connector requires
visible Joliet ownership, the exact phone anchor, native navigation, iframe,
single-yard public configuration and exact official/API stock joins.

Coordinates 41.5224678, -88.0560742 come from the matching ASYD `AutoPartsStore`
business record, not an official map or viewport. The retained profile is
`.scratchpad/coverage/parallel-il-mo-ks/next-pass/evidence/asyd-more-profile-joliet-u-pull-it-joliet-il.body`,
SHA-256 `9c516e289cf3ebc8e91ade499b074712a71d95599c239e00dd4ab49761ce70c6`.
Its first JSON-LD script, array element zero, publishes the same name, address,
phone and website with the record-specific `geo` point. Independent ownership
and geography evidence is in
`.scratchpad/coverage/parallel-il-mo-ks/joliet-source-review/`.

## Complete native scope

The inventory publishes one complete `table-parts` table with Year, Make, Model,
Stock#, Vehicle Row and Date Set in Yard. The connector derives every exact
native make/model pair from this table. It uses the public frontend's ordinary
`POST /searchVehicleHttp` route at
`https://inventory-search-api-581547763015.us-central1.run.app`:

```json
{
  "yard_id": "joliet_u_pull_it",
  "year_min": null,
  "year_max": null,
  "make": "<exact official table make>",
  "model": "<exact official table model>",
  "language": "en",
  "location_id": null
}
```

No blank searches, wildcards, generic group discovery, guessed endpoints or VIN
lookups are used. Strict responses must echo the exact yard and criteria, report
success and reconcile `match_count` with the complete matches array. Native
records must identify Joliet U-Pull-It and the `crush` source system.

Each query must return every stock belonging to its exact official table pair,
including stocks already found in an overlapping search. Each returned stock
must join the official table at the same source year. Missing or foreign stocks,
within-response duplicate stocks, conflicting valid VINs and changed stable
records block the snapshot.

Optional position and rendered calendar dates should agree when both sources
publish usable values. The table and API publish separately, so a vehicle the
yard re-sets or moves can show a different row or set date in each for a while.
On November 25, 2026, STK076422 (2013 Chevrolet Cruze, re-set on November 24)
disagreed during the overnight publish and rejected the whole yard. A stock with
a valid identity and such a conflict is now quarantined: it is not published,
its VIN supplies presence so its prior listing stays unchanged, and a warning
names both values. Quarantined stocks count toward the 5% stock disagreement
limit with HTML-only and API-only stocks, and are left out of the rejection
denominator. A year or VIN conflict still blocks the snapshot.

Each chunk validates five public contexts in order: the root's active
self-service ownership, contact ownership, complete inventory table,
`GET /api/yard-info/joliet` and
`GET /api/analytics/year-distribution?yard_id=joliet_u_pull_it`. The config must
retain the exact single Joliet owner, Chicago timezone, enabled vehicle search,
disabled demo synthesis and disabled photos. Every native year bucket and total
must match the full official table. A context digest includes source identity,
physical metadata, table, query directory, config and counts. The terminal query
repeats all five contexts before accepting completion.

Joliet republishes its table and counts overnight, at about 07:30 UTC, while the
07:00 UTC crawl is still running. When a resumed chunk or the terminal closing
context finds a different digest, the crawl restarts from query 0 under the new
context instead of failing. A resumed chunk restarts in place and searches the
new context's first pair. A terminal change publishes nothing from that chunk and
leaves a `restart` cursor for the next chunk. A restart discards all stock and
receipt progress, and its staged chunk carries a restart marker, so publication
ignores vehicles, observations and counts staged before it. The restart counter
is part of the checksummed cursor. A run may restart twice; a third change fails
the source and preserves prior inventory.

The saved scope contains 1,406 unique stocks and 309 exact native pairs. All
1,406 stocks appear in their own queries. The responses contain 1,893 hits,
including 487 agreeing cross-query repeats. Total/year/stock/position/date parity
is exact. Native duplicate donor VIN count is zero.

## Field and quality contract

Admission requires an actual source modern VIN or supported pre-1981 serial,
usable native YMM and the verified physical owner. Existing `inventoryVin` and
required placeholder guards remain in force. Invalid required metadata rejects
the donor; a separately valid rejected identity supplies presence only. This
snapshot has 14 malformed modern VINs and no valid rejected presence identities.
The three retained older serials are `1Z37T4S415983` (1974 Chevrolet Corvette),
`J5172085` (1969 Cadillac Deville) and `FM11092U` (1974 Triumph Spitfire).

Canonical YMM uses the complete API tuple. Five native makes and 248 native
models differ from the official table's representations, including table SCION
versus API TOYOTA. Both representations remain in evidence. No hybrid tuple,
guessed model equivalence or VIN-derived year is substituted. `detailsUrl` is
the unfiltered official inventory URL because API labels need not equal native
filter labels.

Color, photos, source date and position may be null without rejecting a valid
donor. All saved colors/photos are null; photos are never fetched. Native stock
is the verified source traversal/join key and is displayed unchanged, rather
than replaced with a generated source identifier. The API's explicit full-year
`dateAdded` contributes a calendar date only. Its timestamp has no UTC offset,
so no instant is inferred. The table's `MM.DD.YY` is retained as a display value
and compared to the rendered API date, without assigning it a century.

Cross-query coverage repeats count as `recordsExcluded` after stable native
field agreement, excluding only the clock-derived `daysInYard` metric. They do
not count as duplicate donors. Expected accounting is 1,893 processed, 487
excluded, 14 rejected and 1,392 unique emitted. Shared metrics therefore have
1,406 eligible donors, zero duplicates and a 0.996% rejection rate. Repeats
cannot dilute the rejection denominator.

The source floor is 464 accepted unique donors. The unchanged 10% rejection,
25% duplicate and 50% prior-count drift guards apply. Only terminal accepted
snapshots can reconcile inventory.

## Checkpoints and recovery

Strict cursors have `start`, `queries`, `restart` and `complete` phases. A
`restart` cursor holds only the restart count. A query cursor stores the
owner/scope digest, restart count, next query index, pair count, native response
receipts and cumulative per-stock identity/status/fingerprint/first-query state.
Status is `available`, `incomplete` or `conflict`. Code that predates `conflict`
rejects a cursor holding one, so a rollback fails that run and keeps prior
inventory; the next scheduled run starts clean.
Query and `complete` cursors omit the restart count at zero, so checkpoints
written before restarts resume unchanged.

Rollback: code that predates restarts ignores restart markers on staged chunks
and would union superseded chunks into the snapshot. A restarted run therefore
ends with `complete` plus its restart count, which that code's strict cursor
rejects, so the source fails and prior inventory stays published. After a
rollback, an in-flight restarted Joliet run fails the same way; let the next
scheduled run crawl from `start`.
A checksum binds every resume field independently of JSON property order. This
detects corruption of trusted durable state and does not authenticate arbitrary
rewritten cursors. Unique stock/VIN states, sequential own-query coverage and
receipt/new-stock accounting are validated before advancing.

Chunks process 1 through 32 queries, default 16. Validation and terminal closing
reads finish before callbacks; callback failure returns no advanced checkpoint.
Completed cursors make no requests or callbacks. The count-and-discard driver,
`scripts/soak-joliet.ts`, accepts a total query budget from 1 through 2,000 and
performs no inventory writes.

Requests use the shared provider gate at 1.6 seconds, zero automatic retries,
20-second request/body limits and a three-minute chunk deadline. Only complete
HTTP 200 bodies with the verified endpoint, expected MIME, valid UTF-8 and a
maximum of 4 MiB are accepted. Redirects, partial ranges and length mismatches
fail. On failure, prior accepted inventory remains intact. Inspect the source
and resume the last validated checkpoint. Changed source context starts a new
complete crawl in the same run, at most twice.

## Saved verification

Qualification evidence is under
`.scratchpad/coverage/parallel-ut-co-ok/joliet-20261112/`. Its request manifest
contains 2 GETs and 309 read-only POSTs with bodies, paths, bytes and SHA-256.
Independent source review verifies every retained body and all stock/field
classifications without HTTP. Original root, inventory and public config remain
under `.scratchpad/coverage/new-leads/`.

`joliet-implementation-replay.ts` exercises the actual connector and shared
durable codec at query budgets 1, 16 and 32. It checks every official table field,
all canonical fields, presence, yard metadata and shared quality boundaries.
The resulting 309, 20 and 10 chunks make 1,859, 414 and 364 cached calls, with
zero live calls. `joliet-soak-replay.ts` exercises the actual soak/connector with
40 actual codec round trips, 414 cached calls and identical canonical output.
Reports, request manifests, checkpoints, input hashes and canonical records are
in `implementation-replay/`. Canonical SHA-256 is
`c7a4d5673c3815b9e42bb23673c779a437fa9fdf60d9a529b40fe74628187b96`.

The new pure `vinplus-protocol.ts` shares only strict native envelopes, exact
query encoding, analytics and primitive text/calendar-date parsing. Joliet's
owner, selectors, metadata exclusions, config, HTTP, cursor and join/accounting
policy stay explicit. No Littleton implementation or frozen artifact is changed.

The November 15 saved HTML and analytics differ by 25 absolute year-count
entries across 1,411 HTML stocks (1.77%), despite a net count difference of one.
The disagreement limit is 5% of the HTML inventory. Only agreeing stocks are
published; HTML-only and API-only stocks are excluded and reported. Exact API
union-to-analytics reconciliation and all other quality guards still apply.

The analytics counts and year searches also move within a day. On November 26,
2026, run f4ee8a12 read an API union of 1,415 against analytics of 1,418, with
1996, 1999 and 2002 each off by one, and the API year searches had changed by
15:27. A union mismatch is therefore a transient rejection: its message names
the totals and the first differing years with both counts, prior inventory is
preserved, and the source retries after the usual delay within its daily
attempts. The 5% stock disagreement limit and the rejection ratio still end the
source's day.
