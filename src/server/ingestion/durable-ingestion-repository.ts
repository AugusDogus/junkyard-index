import type { Client, InStatement, InValue } from "@libsql/client";
import { and, eq, sql } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { isIngestionSource } from "~/lib/ingestion-source";
import { ingestionRun, ingestionSourceRun, vehicleSnapshot } from "~/schema";
import type {
  DurableSourceChunkResult,
  DurableIngestionWakeupResult,
  FetchedDurableSourceChunk,
  InitializeDurableIngestionResult,
} from "./durable-ingestion-types";
import {
  DURABLE_INITIAL_SOURCE_CURSORS,
  durableSourceCursorEquals,
  getDurableSourceDefinition,
  parseDurableSourceCursor,
  serializeDurableSourceCursor,
  type DurableCursorFor,
  type DurableIngestionSource,
} from "./durable-source";
import type { CanonicalVehicle } from "./types";

const SNAPSHOT_WRITE_BATCH_SIZE = 500;
const SNAPSHOT_VALUE_COLUMN_COUNT = 24;
const SNAPSHOT_CLEANUP_BATCH_SIZE = 5_000;
const INGESTION_DUE_HOUR_UTC = 7;

type SourceRunStatus = "running" | "success" | "partial" | "error";
type LibSqlBatchClient = Pick<Client, "batch">;

function sourceRunId(runId: string, source: DurableIngestionSource): string {
  return `${runId}:${source}`;
}

function sourceRunInsertStatement(
  runId: string,
  initialCursor: (typeof DURABLE_INITIAL_SOURCE_CURSORS)[number],
  startedAt: Date,
): InStatement {
  const cursor = serializeDurableSourceCursor(initialCursor);
  return {
    sql: `
      insert into ingestion_source_run (
        id, run_id, source, status, start_cursor, next_cursor, started_at
      )
      select ?, ?, ?, 'running', ?, ?, ?
      where exists (
        select 1 from ingestion_run
        where id = ? and status = 'running' and active_slot = 1
      )
      on conflict(id) do nothing
    `,
    args: [
      sourceRunId(runId, initialCursor.source),
      runId,
      initialCursor.source,
      cursor,
      cursor,
      startedAt.getTime(),
      runId,
    ],
  };
}

export function ingestionScheduleKey(now: Date): string {
  const shifted = new Date(
    now.getTime() - INGESTION_DUE_HOUR_UTC * 60 * 60 * 1000,
  );
  return shifted.toISOString().slice(0, 10);
}

export function parseIngestionErrors(errorsJson: string | null): string[] {
  if (!errorsJson) return [];
  try {
    const parsed: unknown = JSON.parse(errorsJson);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is string => typeof entry === "string");
  } catch {
    return [];
  }
}

function deduplicateErrors(errors: readonly string[]): string[] {
  return [...new Set(errors)];
}

function statusForFailedSource(vehiclesProcessed: number): SourceRunStatus {
  return vehiclesProcessed > 0 ? "partial" : "error";
}

function toSnapshotValues(vehicle: CanonicalVehicle): InValue[] {
  return [
    vehicle.vin,
    vehicle.year,
    vehicle.make,
    vehicle.model,
    vehicle.color,
    vehicle.stockNumber,
    vehicle.imageUrl,
    vehicle.availableDate,
    vehicle.locationCode,
    vehicle.locationName,
    vehicle.locationCity,
    vehicle.state,
    vehicle.stateAbbr,
    vehicle.lat,
    vehicle.lng,
    vehicle.section,
    vehicle.row,
    vehicle.space,
    vehicle.detailsUrl,
    vehicle.partsUrl,
    vehicle.pricesUrl,
    vehicle.engine,
    vehicle.trim,
    vehicle.transmission,
  ];
}

function snapshotInsertStatement(params: {
  runId: string;
  source: DurableIngestionSource;
  expectedCursor: string;
  vehicles: CanonicalVehicle[];
}): InStatement {
  const rowPlaceholder = `(${Array.from(
    { length: SNAPSHOT_VALUE_COLUMN_COUNT },
    () => "?",
  ).join(", ")})`;
  const valuePlaceholders = params.vehicles
    .map(() => rowPlaceholder)
    .join(", ");
  const valueColumns = Array.from(
    { length: SNAPSHOT_VALUE_COLUMN_COUNT },
    (_, index) => `column${index + 1}`,
  ).join(", ");

  return {
    sql: `
      insert into vehicle_snapshot (
        run_id, source, vin, year, make, model, color, stock_number,
        image_url, available_date, location_code, location_name,
        location_city, state, state_abbr, lat, lng, section, row, space,
        details_url, parts_url, prices_url, engine, trim, transmission
      )
      select ?, ?, ${valueColumns}
      from (values ${valuePlaceholders})
      where exists (
        select 1
        from ingestion_source_run source_run
        join ingestion_run run on run.id = source_run.run_id
        where source_run.id = ?
          and source_run.run_id = ?
          and source_run.source = ?
          and source_run.status = 'running'
          and source_run.next_cursor = ?
          and run.status = 'running'
      )
      on conflict(run_id, source, vin) do nothing
    `,
    args: [
      params.runId,
      params.source,
      ...params.vehicles.flatMap(toSnapshotValues),
      sourceRunId(params.runId, params.source),
      params.runId,
      params.source,
      params.expectedCursor,
    ],
  };
}

export function snapshotToVehicle(
  row: typeof vehicleSnapshot.$inferSelect,
): CanonicalVehicle {
  if (!isIngestionSource(row.source)) {
    throw new Error(
      `Snapshot ${row.runId}/${row.vin} has unsupported source ${row.source}`,
    );
  }
  return {
    vin: row.vin,
    source: row.source,
    year: row.year,
    make: row.make,
    model: row.model,
    color: row.color,
    stockNumber: row.stockNumber,
    imageUrl: row.imageUrl,
    availableDate: row.availableDate,
    locationCode: row.locationCode,
    locationName: row.locationName,
    locationCity: row.locationCity,
    state: row.state,
    stateAbbr: row.stateAbbr,
    lat: row.lat,
    lng: row.lng,
    section: row.section,
    row: row.row,
    space: row.space,
    detailsUrl: row.detailsUrl,
    partsUrl: row.partsUrl,
    pricesUrl: row.pricesUrl,
    engine: row.engine,
    trim: row.trim,
    transmission: row.transmission,
  };
}

function toChunkResult<Source extends DurableIngestionSource>(
  source: Source,
  row: typeof ingestionSourceRun.$inferSelect,
): DurableSourceChunkResult<Source> {
  return {
    cursor: parseDurableSourceCursor(
      source,
      row.nextCursor ??
        serializeDurableSourceCursor(
          getDurableSourceDefinition(source).initialCursor,
        ),
    ),
    status:
      row.status === "running"
        ? "paused"
        : row.status === "success"
          ? "complete"
          : "failed",
    count: row.vehiclesProcessed,
    uniqueVehicles: row.uniqueVehicles,
    duplicateVehicles: row.duplicateVehicles,
    rejectedVehicles: row.rejectedVehicles,
    pagesProcessed: row.pagesProcessed,
    errors: parseIngestionErrors(row.errors),
  };
}

export function createDurableIngestionRepository(
  database: LibSQLDatabase,
  batchClient: LibSqlBatchClient,
) {
  return {
    async prepareWakeup(
      now = new Date(),
    ): Promise<DurableIngestionWakeupResult> {
      const scheduleKey = ingestionScheduleKey(now);
      await database
        .update(ingestionRun)
        .set({ activeSlot: null })
        .where(
          and(
            eq(ingestionRun.activeSlot, 1),
            sql`${ingestionRun.status} != 'running'`,
          ),
        );
      const [activeRun] = await database
        .select({ id: ingestionRun.id })
        .from(ingestionRun)
        .where(eq(ingestionRun.activeSlot, 1))
        .limit(1);
      if (activeRun) return { status: "resume", runId: activeRun.id };

      const [publishedRun] = await database
        .select({ id: ingestionRun.id })
        .from(ingestionRun)
        .where(
          and(
            eq(ingestionRun.scheduleKey, scheduleKey),
            eq(ingestionRun.fullReindexRequired, false),
            eq(ingestionRun.inventoryOutcome, "published"),
            sql`${ingestionRun.searchPublishedAt} is not null`,
          ),
        )
        .limit(1);
      if (publishedRun) {
        return { status: "not_due", publishedRunId: publishedRun.id };
      }

      const runId = crypto.randomUUID();
      try {
        await batchClient.batch(
          [
            {
              sql: `
                insert into ingestion_run (
                  id, source, schedule_key, status, stage, active_slot,
                  full_reindex_required, started_at, last_progress_at
                )
                values (?, 'all', ?, 'running', 'sources', 1,
                  case when exists (
                    select 1 from ingestion_run
                    where full_reindex_required = 1
                  ) then 1 else 0 end,
                  ?, ?)
              `,
              args: [runId, scheduleKey, now.getTime(), now.getTime()],
            },
            ...DURABLE_INITIAL_SOURCE_CURSORS.map((cursor) =>
              sourceRunInsertStatement(runId, cursor, now),
            ),
          ],
          "write",
        );
        return { status: "start", runId };
      } catch (error) {
        const [winner] = await database
          .select({ id: ingestionRun.id })
          .from(ingestionRun)
          .where(eq(ingestionRun.activeSlot, 1))
          .limit(1);
        if (winner) return { status: "resume", runId: winner.id };
        throw error;
      }
    },

    async attachWorkflowRun(
      runId: string,
      workflowRunId: string,
    ): Promise<void> {
      await database
        .update(ingestionRun)
        .set({ workflowRunId })
        .where(
          and(
            eq(ingestionRun.id, runId),
            eq(ingestionRun.status, "running"),
            eq(ingestionRun.activeSlot, 1),
          ),
        );
    },

    async initialize(runId: string): Promise<InitializeDurableIngestionResult> {
      const startedAt = new Date();
      const results = await batchClient.batch(
        [
          {
            sql: `
              insert into ingestion_run (
                id, source, status, stage, active_slot, full_reindex_required,
                started_at, last_progress_at
              )
              select ?, 'all', 'running', 'sources', 1,
                     case when exists (
                       select 1 from ingestion_run
                       where full_reindex_required = 1
                     ) then 1 else 0 end,
                     ?, ?
              where not exists (
                select 1 from ingestion_run where active_slot = 1
              )
              on conflict(id) do nothing
            `,
            args: [runId, startedAt.getTime(), startedAt.getTime()],
          },
          ...DURABLE_INITIAL_SOURCE_CURSORS.map((cursor) =>
            sourceRunInsertStatement(runId, cursor, startedAt),
          ),
        ],
        "write",
      );
      const inserted = results[0];
      if (!inserted) {
        throw new Error(`Ingestion run ${runId} initialization had no result.`);
      }
      if (inserted.rowsAffected === 1) {
        return { status: "started", runId };
      }
      const [activeRun] = await database
        .select({ id: ingestionRun.id })
        .from(ingestionRun)
        .where(eq(ingestionRun.activeSlot, 1))
        .limit(1);
      return activeRun?.id === runId
        ? { status: "started", runId }
        : { status: "deduplicated", activeRunId: activeRun?.id ?? null };
    },

    async getCheckpoint<Source extends DurableIngestionSource>(params: {
      runId: string;
      requestedCursor: DurableCursorFor<Source>;
    }): Promise<DurableSourceChunkResult<Source> | null> {
      const source = params.requestedCursor.source;
      const id = sourceRunId(params.runId, source);
      const [row] = await database
        .select()
        .from(ingestionSourceRun)
        .where(eq(ingestionSourceRun.id, id))
        .limit(1);
      if (!row) {
        throw new Error(
          `Source run ${id} does not exist. Initialize the ingestion run first.`,
        );
      }
      const result = toChunkResult(source, row);
      return row.status !== "running" ||
        !durableSourceCursorEquals(result.cursor, params.requestedCursor)
        ? result
        : null;
    },

    async checkpointChunk<Source extends DurableIngestionSource>(params: {
      runId: string;
      requestedCursor: DurableCursorFor<Source>;
      fetched: FetchedDurableSourceChunk<NoInfer<Source>>;
    }): Promise<DurableSourceChunkResult<Source>> {
      const source = params.requestedCursor.source;
      if (params.fetched.cursor.source !== source) {
        throw new Error(
          `Cannot checkpoint ${params.fetched.cursor.source} cursor for ${source} source run`,
        );
      }
      const mismatchedVehicle = params.fetched.vehicles.find(
        (vehicle) => vehicle.source !== source,
      );
      if (mismatchedVehicle) {
        throw new Error(
          `Cannot checkpoint ${mismatchedVehicle.source} vehicle ${mismatchedVehicle.vin} for ${source} source run`,
        );
      }
      const id = sourceRunId(params.runId, source);
      const [current] = await database
        .select()
        .from(ingestionSourceRun)
        .where(eq(ingestionSourceRun.id, id))
        .limit(1);
      if (!current) {
        throw new Error(`Source run ${id} disappeared during checkpointing.`);
      }
      const currentResult = toChunkResult(source, current);
      if (
        current.status !== "running" ||
        !durableSourceCursorEquals(currentResult.cursor, params.requestedCursor)
      ) {
        return currentResult;
      }

      const errors = deduplicateErrors([
        ...parseIngestionErrors(current.errors),
        ...params.fetched.errors,
      ]);
      const vehiclesProcessed =
        current.vehiclesProcessed + params.fetched.vehiclesProcessed;
      const uniqueVehicles =
        current.uniqueVehicles + params.fetched.uniqueVehicles;
      const duplicateVehicles =
        current.duplicateVehicles + params.fetched.duplicateVehicles;
      const rejectedVehicles =
        current.rejectedVehicles + params.fetched.rejectedVehicles;
      const pagesProcessed =
        current.pagesProcessed + params.fetched.pagesProcessed;
      const terminal = params.fetched.status !== "paused";
      const status: SourceRunStatus =
        params.fetched.status === "paused"
          ? "running"
          : params.fetched.status === "complete"
            ? "success"
            : statusForFailedSource(vehiclesProcessed);
      const expectedCursor = serializeDurableSourceCursor(
        params.requestedCursor,
      );
      const nextCursor = serializeDurableSourceCursor(params.fetched.cursor);
      const statements: InStatement[] = [];

      for (
        let start = 0;
        start < params.fetched.vehicles.length;
        start += SNAPSHOT_WRITE_BATCH_SIZE
      ) {
        const vehicles = params.fetched.vehicles.slice(
          start,
          start + SNAPSHOT_WRITE_BATCH_SIZE,
        );
        if (vehicles.length === 0) continue;
        statements.push(
          snapshotInsertStatement({
            runId: params.runId,
            source,
            expectedCursor,
            vehicles,
          }),
        );
      }

      const checkpointStatementIndex = statements.length;
      statements.push({
        sql: `
          update ingestion_source_run
          set status = ?,
              next_cursor = ?,
              pages_processed = ?,
              vehicles_processed = ?,
              unique_vehicles = ?,
              duplicate_vehicles = ?,
              rejected_vehicles = ?,
              errors = ?,
              completed_at = ?
          where id = ?
            and run_id = ?
            and source = ?
            and status = 'running'
            and next_cursor = ?
            and exists (
              select 1 from ingestion_run
              where id = ? and status = 'running'
            )
        `,
        args: [
          status,
          nextCursor,
          pagesProcessed,
          vehiclesProcessed,
          uniqueVehicles,
          duplicateVehicles,
          rejectedVehicles,
          errors.length > 0 ? JSON.stringify(errors) : null,
          terminal ? Date.now() : null,
          id,
          params.runId,
          source,
          expectedCursor,
          params.runId,
        ],
      });
      statements.push({
        sql: `
          update ingestion_run
          set last_progress_at = ?
          where id = ?
            and status = 'running'
            and exists (
              select 1 from ingestion_source_run
              where id = ? and next_cursor = ?
            )
        `,
        args: [Date.now(), params.runId, id, nextCursor],
      });

      const results = await batchClient.batch(statements, "write");
      const checkpointResult = results[checkpointStatementIndex];
      if (!checkpointResult) {
        throw new Error(`Source run ${id} checkpoint returned no result.`);
      }
      if (checkpointResult.rowsAffected === 1) {
        return {
          cursor: params.fetched.cursor,
          status: params.fetched.status,
          count: vehiclesProcessed,
          uniqueVehicles,
          duplicateVehicles,
          rejectedVehicles,
          pagesProcessed,
          errors,
        };
      }
      if (checkpointResult.rowsAffected !== 0) {
        throw new Error(
          `Source run ${id} checkpoint affected ${checkpointResult.rowsAffected} rows; expected 0 or 1.`,
        );
      }

      const [latest] = await database
        .select()
        .from(ingestionSourceRun)
        .where(eq(ingestionSourceRun.id, id))
        .limit(1);
      if (!latest) {
        throw new Error(`Source run ${id} disappeared after checkpointing.`);
      }
      return toChunkResult(source, latest);
    },

    async markSourceFailed<Source extends DurableIngestionSource>(params: {
      runId: string;
      source: Source;
      message: string;
    }): Promise<DurableSourceChunkResult<Source>> {
      const id = sourceRunId(params.runId, params.source);
      const [current] = await database
        .select()
        .from(ingestionSourceRun)
        .where(eq(ingestionSourceRun.id, id))
        .limit(1);
      if (!current) throw new Error(`Cannot fail missing source run ${id}.`);
      if (current.status !== "running") {
        return toChunkResult(params.source, current);
      }

      const errors = deduplicateErrors([
        ...parseIngestionErrors(current.errors),
        params.message,
      ]);
      const status: SourceRunStatus =
        current.vehiclesProcessed > 0 ? "partial" : "error";
      const updated = await database
        .update(ingestionSourceRun)
        .set({
          status,
          errors: JSON.stringify(errors),
          completedAt: new Date(),
        })
        .where(
          and(
            eq(ingestionSourceRun.id, id),
            eq(ingestionSourceRun.status, "running"),
            sql`exists (
              select 1 from ingestion_run
              where id = ${params.runId}
                and status = 'running'
                and active_slot = 1
            )`,
          ),
        );
      if (updated.rowsAffected === 1) {
        return {
          ...toChunkResult(params.source, current),
          status: "failed",
          errors,
        };
      }
      const [latest] = await database
        .select()
        .from(ingestionSourceRun)
        .where(eq(ingestionSourceRun.id, id))
        .limit(1);
      if (!latest) throw new Error(`Source run ${id} disappeared.`);
      return toChunkResult(params.source, latest);
    },

    async getRun(runId: string) {
      const [run] = await database
        .select()
        .from(ingestionRun)
        .where(eq(ingestionRun.id, runId))
        .limit(1);
      if (!run) throw new Error(`Ingestion run ${runId} does not exist.`);
      return run;
    },

    getSourceRuns(runId: string) {
      return database
        .select()
        .from(ingestionSourceRun)
        .where(eq(ingestionSourceRun.runId, runId));
    },

    async markRunFailed(runId: string, message: string): Promise<void> {
      const [run] = await database
        .select({
          executionErrors: ingestionRun.executionErrors,
          stage: ingestionRun.stage,
        })
        .from(ingestionRun)
        .where(eq(ingestionRun.id, runId))
        .limit(1);
      if (!run)
        throw new Error(`Cannot record failure for missing run ${runId}.`);
      const errors = deduplicateErrors([
        ...parseIngestionErrors(run.executionErrors),
        message,
      ]);
      await database
        .update(ingestionRun)
        .set({
          executionErrors: JSON.stringify(errors),
          stage:
            run.stage === "full_reindex_publish"
              ? "full_reindex_publish_failed"
              : run.stage,
        })
        .where(
          and(
            eq(ingestionRun.id, runId),
            eq(ingestionRun.status, "running"),
            eq(ingestionRun.activeSlot, 1),
            eq(ingestionRun.stage, run.stage),
          ),
        );
    },

    async abandon(runId: string, force: boolean): Promise<string | null> {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const [run] = await database
          .select({
            stage: ingestionRun.stage,
            status: ingestionRun.status,
            fullReindexRequired: ingestionRun.fullReindexRequired,
            workflowRunId: ingestionRun.workflowRunId,
          })
          .from(ingestionRun)
          .where(eq(ingestionRun.id, runId))
          .limit(1);
        if (!run) throw new Error(`Cannot abandon missing run ${runId}.`);
        if (run.status !== "running") return null;
        if (run.stage === "full_reindex_move_pending") {
          throw new Error(
            `Run ${runId} has an unconfirmed Algolia index move and cannot be abandoned. Retry after Algolia publication is confirmed.`,
          );
        }
        const reconciliationStarted = run.stage !== "sources";
        if (reconciliationStarted && !force) {
          throw new Error(
            `Run ${runId} entered ${run.stage}; force is required and will mandate a full Algolia rebuild.`,
          );
        }
        const completedAt = Date.now();
        const results = await batchClient.batch(
          [
            {
              sql: `
                update ingestion_run
                set status = 'abandoned', active_slot = null,
                    full_reindex_required = ?, completed_at = ?, released_at = ?
                where id = ? and status = 'running' and active_slot = 1
                  and stage = ?
              `,
              args: [
                Number(reconciliationStarted || run.fullReindexRequired),
                completedAt,
                completedAt,
                runId,
                run.stage,
              ],
            },
            {
              sql: `
                update ingestion_source_run
                set status = 'error', completed_at = ?
                where run_id = ? and status = 'running'
                  and exists (
                    select 1 from ingestion_run
                    where id = ? and status = 'abandoned'
                  )
              `,
              args: [completedAt, runId, runId],
            },
            {
              sql: `
                update search_notification_intent
                set status = 'cancelled', cancelled_at = ?, claim_token = null,
                    last_error = 'owning_ingestion_run_abandoned'
                where run_id = ?
                  and status in ('pending', 'retry', 'sending')
                  and exists (
                    select 1 from ingestion_run
                    where id = ? and status = 'abandoned'
                  )
              `,
              args: [completedAt, runId, runId],
            },
          ],
          "write",
        );
        const abandoned = results[0];
        if (!abandoned) {
          throw new Error(`Abandoning ingestion run ${runId} had no result.`);
        }
        if (abandoned.rowsAffected === 1) return run.workflowRunId;
      }
      throw new Error(
        `Ingestion run ${runId} kept advancing while abandonment was attempted. Retry the request.`,
      );
    },

    async cleanupSnapshotBatch(runId: string) {
      const result = await database.run(sql`
        delete from vehicle_snapshot
        where rowid in (
          select snapshot.rowid
          from vehicle_snapshot snapshot
          join ingestion_run run on run.id = snapshot.run_id
          where snapshot.run_id = ${runId}
            and run.active_slot is null
          limit ${SNAPSHOT_CLEANUP_BATCH_SIZE}
        )
      `);
      return {
        deleted: result.rowsAffected,
        done: result.rowsAffected < SNAPSHOT_CLEANUP_BATCH_SIZE,
      };
    },

    async cleanupStaleSnapshots(): Promise<void> {
      await database.run(sql`
        delete from vehicle_snapshot
        where rowid in (
          select snapshot.rowid
          from vehicle_snapshot snapshot
          join ingestion_run run on run.id = snapshot.run_id
          where run.active_slot is null
          limit ${SNAPSHOT_CLEANUP_BATCH_SIZE}
        )
      `);
    },
  };
}

export type DurableIngestionRepository = ReturnType<
  typeof createDurableIngestionRepository
>;
