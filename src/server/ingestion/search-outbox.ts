/**
 * `vehicle_change_v2` as the search outbox. Reconciliation writes each
 * vehicle change in the same transaction as the vehicle mutation, and the
 * search projector, the only search writer in decoupled publication, keeps
 * the id of the last change it made searchable in its consumer checkpoint.
 *
 * Ids are assigned in commit order: SQLite (and Turso) serialize write
 * transactions, so no transaction can commit a lower id after a reader saw a
 * higher one. Enabling Turso concurrent writes (MVCC) on this database would
 * break that, and with it every cursor over this table.
 */
const CHECKPOINT_NAME = "search-projector";

/**
 * The id of the last change the search projector made searchable; 0 before
 * it ever ran. Changes at or below it are in search (or were superseded by a
 * later projection of the same vehicle).
 */
const PROJECTED_THROUGH_SQL = `coalesce((
  select checkpoint.last_processed_change_id
  from ingestion_projector_checkpoint checkpoint
  where checkpoint.name = '${CHECKPOINT_NAME}'
), 0)`;

export const SearchOutbox = {
  checkpointName: CHECKPOINT_NAME,

  projectedThroughSql: PROJECTED_THROUGH_SQL,

  /**
   * Whether the run aliased `run` wrote a change above `through` (an SQL
   * expression or placeholder), that is, one that may not be searchable yet.
   */
  runHasChangesAboveSql(run: string, through: string): string {
    return `exists (
      select 1 from vehicle_change_v2 outbox_change
      where outbox_change.run_id = ${run}.id and outbox_change.id > ${through}
    )`;
  },

  /**
   * Whether a finished run left changes the search projector has not made
   * searchable. Inline runs delete their changes once searchable, and leave
   * them only with `full_reindex_required`; decoupled runs leave them for the
   * projector. So after decoupled publication is switched back off, this
   * makes the first inline publisher rebuild the index, as the skipped
   * publication flag does.
   */
  finishedRunOwesSearchSql: `exists (
    select 1 from vehicle_change_v2 outbox_change
    join ingestion_run finished on finished.id = outbox_change.run_id
    where finished.active_slot is null
      and outbox_change.id > ${PROJECTED_THROUGH_SQL}
  )`,
} as const;
