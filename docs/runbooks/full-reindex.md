# Full reindex (inline publication)

A run whose commit carries `full_reindex_required = 1` rebuilds the whole
`vehicles` index from Turso instead of projecting its changes. It holds the
shared commit until the rebuild is published, so queued runs wait behind it.

## Choosing copy or in place

`full_reindex_prepare` first deletes leftover `vehicles__rebuild_*` copies,
then compares the Algolia app's records with the cap:

- **needed** = `entries` of every non-virtual index (from `listIndices`, an
  admin call, never a search) + `count(*)` of `vehicle`.
- **usable** = `ALGOLIA_RECORD_LIMIT` (default 1,000,000, the free plan cap)
  less a 2% margin, since entry counts lag writes.

If needed fits, the run copies the live index into
`vehicles__rebuild_<runId>`, loads it and moves it over the live index
(`full_reindex_load`, `full_reindex_publish`). Otherwise it rebuilds in
place. With about 519K live records and 519K vehicles, the copy needs about
1.04M records, so production rebuilds in place on the free plan.

A copy that Algolia refuses with HTTP 403 `QuotaExceeded` is never discarded
and restarted (that looped forever on 2026-11-24, holding the commit). The
run deletes the partial copy and switches to the in-place rebuild, logging
the records needed and the cap. A quota refusal on any other stage fails the
step as before; it is retried and counted toward abandonment.

## In-place rebuild

Search stays live throughout: records are updated in place and stale ones
are removed by the sweep. Settings, synonyms, rules and replicas are never
touched, so there is nothing to carry over as the move did.

1. **`full_reindex_inplace_load`.** 500 vehicles per step in VIN order, saved
   as full records (`projectSearchVehicles`, the same mapping as the copy)
   into the live index. `full_reindex_cursor` holds the last VIN. A retried
   step rewrites the same records.
2. **`full_reindex_inplace_sweep`.** One `browse` page (1,000 objectIDs,
   `attributesToRetrieve: ["objectID"]`) per step. The objectIDs are checked
   against `vehicle` by primary key in chunks of 500, and those Turso lacks
   are deleted. `full_reindex_cursor` holds `{"pass": n, "browse": cursor}`.
   At the end of a pass, one more one-hit browse reads `nbHits`; if the
   index still holds more records than Turso has vehicles (a browse cursor
   can step past records deleted under it), another pass starts, at most 3.
3. **Publish.** As a moved copy publishes, minus the move: the run is
   released, its own and inherited `full_reindex_required` are cleared, and
   unprocessed `vehicle_change_v2` rows are deleted, in one batch.

Peak records are the live index plus vehicles new to it, not two full
indices. Browse pages count as Algolia requests: a sweep of 519K records is
about 520 of them.

If publication switches to decoupled mid-rebuild, the run hands off as from
any other inline stage and keeps `full_reindex_required` for the projector's
own rebuild ([Search projector](search-projector.md)).

## Recovering a run stuck in the copy loop

Workflows keep running the code of the deployment they started on. After the
fix deploys, a run already looping between `full_reindex_prepare` and
`full_reindex_load` still runs the old code and never reaches the in-place
path. To recover:

1. Confirm the deploy is live on `main`'s tip in Vercel.
2. Find the stuck run (read-only):

   ```sql
   select id, stage, full_reindex_cursor, execution_failures, last_progress_at
   from ingestion_run
   where active_slot = 1 and stage like 'full_reindex_%';
   ```

3. Stop it from the admin dashboard's stop-run control, confirming the full
   rebuild (`force`). Abandoning a run past `sources` sets
   `full_reindex_required = 1`, so the next run owes the rebuild. The
   control also cancels the run's workflow; if it reports that cancellation
   failed, cancel the workflow in the Vercel dashboard so it stops writing.
4. Delete its leftover copy if it is still listed
   (`vehicles__rebuild_<runId>`); the next prepare also deletes it.
5. The next run to claim the commit runs on the new deployment, inherits
   `full_reindex_required`, and rebuilds in place. Watch its stage move
   through `full_reindex_inplace_load` and `full_reindex_inplace_sweep` to
   `released`, then check that queued runs publish.

Live search and Turso stay intact throughout: the failed copies never
touched the live index.
