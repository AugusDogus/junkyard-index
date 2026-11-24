# Search projector

The search projector is the only search writer once publication is
decoupled. Source runs end at their final reconciliation batch and never call
Algolia; the projector reads `vehicle_change_v2` as an outbox and writes the
live index, rebuilds it, sweeps leftover copies and checks it for drift.

Code: [`search-projector.ts`](../../src/server/ingestion/search-projector.ts),
[`search-index-rebuild.ts`](../../src/server/ingestion/search-index-rebuild.ts),
[`search-index-drift.ts`](../../src/server/ingestion/search-index-drift.ts),
workflow [`search-projector.ts`](../../src/workflows/search-projector.ts).

## Flags

| Flag                                | Type                            | Effect                                                                                                                                                                                                                                                                                                                                                                                                         |
| ----------------------------------- | ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ingestion-publication-mode`        | string, `inline` or `decoupled` | `decoupled` turns the projector on and makes source runs release at their final batch. A missing flag means `inline`. If the flag cannot be read on Vercel, or serves anything else, the mode is unknown: runs about to reconcile or project write nothing and wait a minute before asking again, without counting a failure (nothing is released, skipped or handed off on a guess), and the projector waits. |
| `consumer-search-projector`         | boolean                         | `false` pauses the projector; it keeps its checkpoint. A missing flag means enabled, but **creating the flag in production serves `false` and pauses it**: create it serving `true`.                                                                                                                                                                                                                           |
| `ingestion-skip-search-publication` | boolean                         | Ignored while decoupled. Keep it on through the cutover so deployments from before the projector never write search.                                                                                                                                                                                                                                                                                           |

## What runs when

- `/api/cron/search-projector` runs at minute 5 of every 10. It starts the
  workflow only when there is work: a rebuild to advance, changes past the
  checkpoint, a circuit to probe, or the day's drift check. Otherwise the
  route reports the tick itself. It never calls Algolia.
- Each decoupled source run starts the projector after it publishes (best
  effort; the cron covers a failed start).
- `POST /api/admin/search/projector` starts it now;
  `POST /api/admin/search/rebuild` requests a full rebuild (409 while one is
  in flight). Both take `Authorization: Bearer $CRON_SECRET`.
- The workflow holds the `search-projector` hook token, so one projector runs
  at a time. The search-index migration takes the same token while it
  writes, and waits while the projector runs.

## State

- `ingestion_projector_checkpoint` row `search-projector`: the last change id
  made searchable (`last_processed_change_id`) and the circuit breaker
  (`failure_count`, `last_error_tag`, `blocked_until`).
- Row `search-projector:drift`: the last drift check (`job_day`, consecutive
  drift days in `failure_count`, counts in `job_cursor`).
- `search_index_generation`: rebuilds, at most one in flight and one live per
  environment.
- `search_dead_letter`: records Algolia rejected (for example a record over
  the size limit). The projector moves past them; fix the data, then request a
  rebuild or touch the vehicle.

## Incremental path

The horizon is the highest change id below the first change of a run still
reconciling (reconciliation is serialized, so every lower id belongs to a run
that published or stopped). Each step reads up to 5,000 changes past the
checkpoint, keeps each VIN's latest change, re-reads the vehicle rows,
upserts them (a missing row or a `delete` change deletes the record), waits
for Algolia, then advances the checkpoint with a compare-and-swap. In the same
transaction it clears `full_reindex_required` on finished runs with no change
above the new checkpoint. Writes are idempotent; a step that dies is redone.

The projector writes nothing while any run is in an inline search stage
(`project_changes`, `full_reindex_*`, `match_alerts`).

## Circuit breaker

Algolia failures never touch `ingestion_run`; only search lags.

- `SearchBackendBlocked`, `QuotaExceeded`, and any `InvalidRequest` the
  projector cannot pin to single records (including a 401 or 403 that
  refuses the key): blocked 15 minutes, doubling to 6 hours. After the wait,
  a settings read probes Algolia before writing. The backoff resets when a
  write lands, or when the probe passes and there is nothing to write.
- `RateLimited`, `NotFound`, `Transient`: 1 minute, doubling to 1 hour.
- A Sentry issue is raised when the circuit opens, not on every tick while it
  stays open. The heartbeat fails on every such tick.

To retry sooner after fixing the cause, clear `blocked_until` on the
`search-projector` checkpoint row.

## Rebuilds

A generation goes `requested` → `loading` → `moving` → `live`. With a live
index, a requested rebuild starts once the projector has caught up with the
outbox; the bootstrap rebuild (no live index yet) starts at once. While a
rebuild is in flight, the search-index migration defers, since the move
would replace its in-place writes.

1. **Prepare.** Delete leftover copies: inline `vehicles__rebuild_*` and any
   `vehicles__generation_*` other than this one (replicas are never touched).
   Refuse to copy while the app's non-virtual records plus `count(*)` of
   `vehicle` exceed `ALGOLIA_RECORD_LIMIT` (default 1,000,000, the free plan
   cap) less a 2% margin, or while there is no live index to copy
   settings from (run the search-index migration once to create it). The
   rebuild then waits (`record_cap` or `missing_live_index`, retried after 15
   minutes doubling to 6 hours, row `search-projector:rebuild-wait`) and the
   live index keeps receiving changes. Record the outbox horizon as
   `snapshot_change_id`, copy the live index's settings, synonyms and rules
   into `vehicles__generation_<id>`, and stamp it with the generation id
   (`userData.junkyardIndexGeneration`).
2. **Load.** 10,000 vehicles per step in VIN order, resumable from
   `vin_cursor`. A generation still loading after 24 hours, or whose copy
   vanished or carries another marker, is discarded and a new one requested.
   If Algolia refuses a load with `QuotaExceeded` (the counts said it fit,
   but the plan disagreed), the copy is deleted at once to free its records,
   the generation is discarded, and the new request waits on `record_cap`
   like a refused prepare. The load is never retried into the quota, so the
   live index keeps receiving changes. The projector does not rebuild in
   place: its generations go live by a verified move and a snapshot replay.
   Over the cap, either free records or raise the plan (and
   `ALGOLIA_RECORD_LIMIT`); see [Full reindex](full-reindex.md) for the
   inline in-place rebuild.
3. **Move.** Move the copy over the live index, record the task id, wait, and
   verify the live marker. A moving generation is never discarded; if its
   move cannot be confirmed the tick reports `move_unconfirmed`: check the
   live index's `userData` in the Algolia dashboard, then mark the row
   `discarded` to let a new rebuild start.
4. **Live.** The previous live generation is superseded and the checkpoint
   jumps to `max(checkpoint, snapshot_change_id)`; changes after the snapshot
   are replayed.

The copy keeps the live index's `searchSchemaVersion`. Schema bumps still go
through the search-index migration. If publication goes back to inline
during a rebuild, the next inline rebuild deletes the generation's copy, and
the projector discards that generation when it runs again.

## Drift check

Once a day, when the projector is caught up and no run is reconciling, it
compares the live index's `entries` (one `listIndices` call, no search) with
`count(*)` of `vehicle` (live and grace-period missing vehicles are both
indexed). A difference over max(100, 0.5%) is drift: it requests a `drift`
rebuild at most once every 7 days, and drift two days in a row fails the
tick so it pages.

## Status

`GET /api/status/search` (no auth, Turso only) returns lag (changes and age of
the oldest unprojected change), the circuit, the live and in-flight
generations, a waiting rebuild and inline writers. It answers 503 while
decoupled search lags over 2 hours, the circuit is open on a blocking
failure (or after 3 failures), no live generation exists, a requested
rebuild cannot start, the database's generations belong to another
environment, or the mode flag cannot be read. It answers 200 while
publication is inline or the projector is paused.

The projector's Better Stack heartbeat key is `search-projector` in
`BETTERSTACK_CONSUMER_HEARTBEATS`. It can stay unset; deploy the code before
adding the key, since the parser rejects unknown keys. A long run reports
progress every 10 steps so the heartbeat stays green.

## Outbox retention

The daily maintenance consumer deletes changes at or below the projector's
checkpoint that the live generation's snapshot covers, or that are older than
14 days (up to 300,000 a day). Nothing is deleted before a generation is
live.

## Cutover to decoupled (relaunch, Stage 5)

1. **Algolia accepts writes** (plan reset or upgrade). In the dashboard, check
   the app's total records: the bootstrap copy needs about as many again as
   `vehicle` has rows (519,152 on Nov 24). Leftover `vehicles__rebuild_*`
   copies are swept automatically before the copy; a standard (non-virtual)
   replica counts in full. **Do not cut over while the copy is over the
   cap.** The bootstrap then waits on `record_cap` indefinitely, so runs
   handed off mid-rebuild never clear `full_reindex_required` and
   saved-search alert checks stall. Raise the plan and `ALGOLIA_RECORD_LIMIT`
   first, and let any inline in-place rebuild
   ([Full reindex](full-reindex.md)) publish before switching.
2. **Keep `ingestion-skip-search-publication` on.** Runs from deployments
   before the projector then release without calling Algolia. It is ignored
   while decoupled; leave it on until the inline path is removed, so a
   rollback never starts inline writes by surprise (see Rollback).
3. **Deploy this stack** and wait until
   `GET /api/admin/search/writers` reports `singleWriter: true`: no run in an
   inline search stage, no ingestion, pass or search-index migration workflow
   pinned to another deployment, and no active run older than the two-day
   listing window. Old runs finish on their own within their pass; recheck.
   Run the check on the production deployment (it needs
   `VERCEL_DEPLOYMENT_ID`).
4. If `consumer-search-projector` exists, make sure it serves `true`.
5. **Create `ingestion-publication-mode`** as a string flag with variants
   `inline` and `decoupled`, and serve `decoupled` in production.
6. **Bootstrap.** With no live generation, the projector's next step requests
   a `bootstrap` rebuild: prepare, about 45 load steps, move, then replay.
   Start it at once with `POST /api/admin/search/projector`. Follow
   `/api/status/search` (`activeGeneration.recordsLoaded`). The Nov 18 index
   keeps serving until the move swaps the new one in.
7. **Verify:**
   - `/api/status/search` is 200 with `lagChanges` near 0 and a
     `liveGeneration`;
   - the tick after catching up reports `drift_checked` with `drifted: false`;
   - no finished run still owes a rebuild:
     `select count(*) from ingestion_run where full_reindex_required = 1 and active_slot is null` is 0;
   - a few VINs read back from the index (dashboard or `getObjects`) match
     Turso.
8. The next maintenance run (08:30 UTC) deletes the skipped period's outbox
   rows covered by the snapshot.
9. Apply the alerts backlog decision, then turn `search-alerts-enabled` on
   (Stage 5, steps 5 and 6). The daily alert check never covers a commit the
   projector has not published.

## Rollback

1. Serve `false` on `consumer-search-projector` (create it serving `false`
   if it does not exist). The pause takes effect at the projector's next
   step.
2. Wait until `GET /api/admin/search/writers` lists no `search-projector`
   run (a step ends within a few minutes).
3. Serve `inline` on `ingestion-publication-mode` (or delete it).
4. Inline publication resumes only once `ingestion-skip-search-publication`
   is off too; turn it off only while Algolia accepts writes. While it stays
   on, runs release with search skipped, the index stays frozen, and
   `/api/status/search` still answers 200 (it reports `inline`).
5. Serve `true` on `consumer-search-projector` again; it does nothing while
   publication is inline.

If the projector had not published every change, the first inline run to
publish rebuilds the whole index, because a finished run has changes above
the projector's checkpoint.

A generation still `requested`, `loading` or `moving` stays in
`search_index_generation` while inline. A `loading` or `moving` one makes the
search-index migration defer; once you have checked in the Algolia dashboard
that its move was not issued (or that its copy is gone), mark it `discarded`.
Before switching back to decoupled after an inline rebuild, request an
operator rebuild so the live generation describes the live index again.
