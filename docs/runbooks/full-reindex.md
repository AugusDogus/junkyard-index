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

A copy that Algolia refuses over its record quota (HTTP 403 `QuotaExceeded`
whose message names the record quota) is never discarded and restarted (that
looped from 2026-11-23, holding the commit). The run first deletes its
partial copy, then switches to the in-place rebuild, logging the records
needed and the cap. If the delete fails, the run stays on the copy path and
the retried step, refused again, deletes and switches then. An operations or
search quota refusal fails the step as before; it is retried and counted
toward abandonment.

## In-place rebuild

Search stays live throughout: records are updated in place and stale ones
are removed by the sweep. Settings, synonyms, rules and replicas are never
touched, so there is nothing to carry over as the move did.

1. **`full_reindex_inplace_load`.** The first step deletes the run's own
   `vehicles__rebuild_<runId>` if it is still there. Then 500 vehicles per
   step in VIN order, saved as full records (`projectSearchVehicles`, the
   same mapping as the copy) into the live index. `full_reindex_cursor` holds
   the last VIN. A retried step rewrites the same records.
2. **`full_reindex_inplace_sweep`.** One `browse` page (1,000 objectIDs,
   `attributesToRetrieve: ["objectID"]`) per step. The objectIDs are checked
   against `vehicle` by primary key in chunks of 500, and those Turso lacks
   are deleted. `full_reindex_cursor` holds `{"pass": n, "browse": cursor}`.
   At the end of a pass, one more one-hit browse reads `nbHits`; if the
   index still holds more records than Turso has vehicles (a browse cursor
   can step past records deleted under it), another pass starts, at most 3.
   If the index ends with fewer records than Turso has vehicles, every load
   batch had already waited for its save, so vehicles are missing. The step
   fails instead of publishing, keeping `full_reindex_required` and the
   change rows; repeated failures abandon the run and the next run rebuilds.
3. **Publish.** As a moved copy publishes, minus the move: the run is
   released, its own and inherited `full_reindex_required` are cleared, and
   unprocessed `vehicle_change_v2` rows are deleted, in one batch.

Peak records are the live index plus vehicles new to it, plus any other
index, not two full indices. If Algolia still refuses an in-place write over
the record quota, the step fails with the live index's records, Turso's
vehicles, every other index holding records and the cap. It keeps its
cursor; the step retries and repeated failures abandon the run. Free
records (leftover `vehicles__rebuild_*` copies or other indices) or raise
the plan and `ALGOLIA_RECORD_LIMIT`.

### Cost and duration

With 519,152 vehicles: about 1,039 load steps (one `saveObjects` batch and
one task wait each) and, per sweep pass, about 520 `browse` pages plus one
probe, at most 3 passes (about 1,566 browses at worst). Turso reads every
vehicle once in the load and looks up every live objectID in the sweep. At
the Nov 21 copy rate (about 8 s per step), expect about 2.3 h of load and
15 to 30 min of sweep. The run holds the commit and the shared Algolia write
lock throughout, so queued runs, alert checks and the 03:00 search-index
migration wait.

Browse pages count as Algolia search requests. On the free plan (10K a
month, resetting on the 21st; using them up blocked reads and writes on
Nov 19), check the usage in the dashboard or the weekly usage email before a
rebuild and before any forced stop. Stopping or abandoning a run in an
in-place stage discards its cursor: the next run restarts the load from the
first vehicle and pays the sweep again.

### Decoupled publication during an in-place rebuild

If publication switches to decoupled mid-rebuild, the run hands off as from
any other inline stage and keeps `full_reindex_required`. Decoupled, that
flag clears only once the search projector serves a live generation, and
the projector's first generation is a copy. Over the record cap it never
starts (`record_cap`, retried with backoff indefinitely), so
`full_reindex_required` never clears and saved-search alert checks wait on
it. While `RecordCapacity.forCopy` reports `over_cap` (the guard's log line),
keep publication inline until `full_reindex_required` is clear on every
run, and raise the plan before switching to decoupled
([Search projector](search-projector.md)).

## Recovering a run stuck in the copy loop

Workflows keep running the code of the deployment they started on. After the
fix deploys, a run already looping between `full_reindex_prepare` and
`full_reindex_load` still runs the old code and never reaches the in-place
path. So do the runs queued behind it, and any retry an older ingestion pass
starts. Claims go to the earliest waiter by `ready_at`, and the claim copies
`full_reindex_required` onto it, so stopping the stuck run alone hands the
loop to the next old waiter.

The `ingestion-skip-search-publication` flag predates the fix, so old-code
runs honor it: at their final reconciliation batch they release with no
Algolia call and set `full_reindex_required`
([Skipping search publication](skip-search-publication.md)). Use it to drain
the old-code runs, then let the first new-code run rebuild in place.

1. Confirm the fix is live on `main`'s tip in Vercel. Note the deploy time.
2. Before any forced stop, check the Algolia search request usage (dashboard
   or the weekly usage email). The in-place rebuild needs about 520 to 1,570
   browse requests (see Cost and duration).
3. Turn `ingestion-skip-search-publication` on (serve `true`).
4. Find the stuck run (read-only) and stop it from the admin dashboard's
   stop-run control, confirming the full rebuild (`force`):

   ```sql
   select id, stage, full_reindex_cursor, execution_failures, last_progress_at
   from ingestion_run
   where active_slot = 1 and stage like 'full_reindex_%';
   ```

   Abandoning a run past `sources` sets `full_reindex_required = 1` and
   deletes its copy. If the control reports that cancelling the workflow
   failed, cancel it in the Vercel dashboard so it stops writing.

5. Let the queued runs claim and release in turn. Each reconciles into Turso
   and releases skipped, so their crawls publish to Turso and search waits.
   Waiters whose staged snapshot is more than 24 h past `ready_at` expire
   with an error instead of publishing. That is safe: prior inventory stays
   live and the source re-crawls. Check them with:

   ```sql
   select id, source, status, errors
   from ingestion_run
   where ready_at < (unixepoch() - 86400) * 1000
     and started_at > (unixepoch() - 3 * 86400) * 1000;
   ```

6. Turn the flag off only once no old-code run can claim the commit:
   - no running run started before the deploy (`<deploy_ms>` is the deploy
     time in epoch milliseconds):

     ```sql
     select id, source, stage, started_at
     from ingestion_run
     where status = 'running' and started_at < <deploy_ms>;
     ```

   - `/admin` shows no active run on another or unknown deployment (a run
     with no workflow and no slot, such as a stale local `all` run, does not
     claim), and
   - the ingestion pass that started before the deploy has ended (the daily
     pass ends at 07:00 UTC) or was cancelled in Vercel, since it starts
     retries on its own old code.

   An old-code run that claims after the flag is off restarts the copy loop.
   If any run enters `full_reindex_prepare` or `full_reindex_load` rather
   than `full_reindex_inplace_load`, it is old code: turn the flag back on
   and stop it.

7. The first inline run on the new code inherits the rebuild at its final
   batch and goes in place. Confirm with `listIndices` (an admin call, not a
   search) that no `vehicles__rebuild_*` remains once it reaches
   `full_reindex_inplace_load`; delete one by hand only if it does. Watch the
   stage move through `full_reindex_inplace_load` and
   `full_reindex_inplace_sweep` to `released` (about 2.5 to 3 h).

Live search and Turso stay intact throughout: the failed copies never
touched the live index, and skipped runs publish to Turso. Alerts wait until
the rebuild publishes, then cover every vehicle that arrived meanwhile.
