import { and, asc, gt, lte } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { vehicleChange } from "~/schema";

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

/** One outbox row as the search projector reads it. */
export interface OutboxChange {
  id: number;
  vin: string;
  /** upsert, missing, delete; anything but delete re-reads the vehicle. */
  changeType: string;
}

/**
 * The highest change id no run is still writing below: one less than the
 * first change of a run still reconciling, otherwise the newest change.
 * Reconciliation holds the shared commit, so at most one run reconciles at a
 * time and every lower id belongs to a run that published or stopped (an
 * abandoned run's changes are real Turso writes, so they are projected too).
 */
const HORIZON_SQL = `
  select coalesce(
    (
      select min((
        select min(change.id) from vehicle_change_v2 change
        where change.run_id = run.id
      )) - 1
      from ingestion_run run
      where run.active_slot = 1
        and run.stage in ('reconcile_upsert', 'reconcile_missing')
    ),
    (select max(id) from vehicle_change_v2),
    0
  ) as horizon
`;

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

  /** The horizon: consumers read only changes at or below it. */
  async horizon(database: LibSQLDatabase): Promise<number> {
    const result = await database.run(HORIZON_SQL);
    const value = result.rows[0]?.horizon;
    if (typeof value !== "number" && typeof value !== "bigint") {
      throw new Error(
        `Reading the search outbox horizon returned ${String(value)}, not a change id. Nothing was projected; the search projector retries its step.`,
      );
    }
    return Number(value);
  },

  /** Changes in (after, through], oldest first. */
  async read(
    database: LibSQLDatabase,
    params: { after: number; through: number; limit: number },
  ): Promise<OutboxChange[]> {
    return database
      .select({
        id: vehicleChange.id,
        vin: vehicleChange.vin,
        changeType: vehicleChange.changeType,
      })
      .from(vehicleChange)
      .where(
        and(
          gt(vehicleChange.id, params.after),
          lte(vehicleChange.id, params.through),
        ),
      )
      .orderBy(asc(vehicleChange.id))
      .limit(params.limit);
  },

  /** When the oldest change in (after, through] was written; null if none. */
  async oldestCreatedAt(
    database: LibSQLDatabase,
    params: { after: number; through: number },
  ): Promise<Date | null> {
    const [oldest] = await database
      .select({ createdAt: vehicleChange.createdAt })
      .from(vehicleChange)
      .where(
        and(
          gt(vehicleChange.id, params.after),
          lte(vehicleChange.id, params.through),
        ),
      )
      .orderBy(asc(vehicleChange.id))
      .limit(1);
    return oldest?.createdAt ?? null;
  },
} as const;
