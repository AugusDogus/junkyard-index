import { and, asc, eq, sql } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { isIngestionSource } from "~/lib/ingestion-source";
import { ingestionRun, ingestionSourceRun, vehicleSnapshot } from "~/schema";
import type {
  DurableSourceChunkResult,
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

const RUN_LOCK_TIMEOUT_MS = 4 * 60 * 60 * 1000;
const STALE_SNAPSHOT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const SNAPSHOT_WRITE_BATCH_SIZE = 500;
const SNAPSHOT_READ_BATCH_SIZE = 5_000;

type SourceRunStatus = "running" | "success" | "partial" | "error";

function sourceRunId(runId: string, source: DurableIngestionSource): string {
  return `${runId}:${source}`;
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

function toSnapshotRow(runId: string, vehicle: CanonicalVehicle) {
  return {
    runId,
    source: vehicle.source,
    vin: vehicle.vin,
    year: vehicle.year,
    make: vehicle.make,
    model: vehicle.model,
    color: vehicle.color,
    stockNumber: vehicle.stockNumber,
    imageUrl: vehicle.imageUrl,
    availableDate: vehicle.availableDate,
    locationCode: vehicle.locationCode,
    locationName: vehicle.locationName,
    locationCity: vehicle.locationCity,
    state: vehicle.state,
    stateAbbr: vehicle.stateAbbr,
    lat: vehicle.lat,
    lng: vehicle.lng,
    section: vehicle.section,
    row: vehicle.row,
    space: vehicle.space,
    detailsUrl: vehicle.detailsUrl,
    partsUrl: vehicle.partsUrl,
    pricesUrl: vehicle.pricesUrl,
    engine: vehicle.engine,
    trim: vehicle.trim,
    transmission: vehicle.transmission,
  };
}

function snapshotToVehicle(
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
    pagesProcessed: row.pagesProcessed,
    errors: parseIngestionErrors(row.errors),
  };
}

export function createDurableIngestionRepository(database: LibSQLDatabase) {
  return {
    async initialize(runId: string): Promise<InitializeDurableIngestionResult> {
      const startedAt = new Date();
      const lockCutoff = startedAt.getTime() - RUN_LOCK_TIMEOUT_MS;

      return database.transaction(async (tx) => {
        const [existingRun] = await tx
          .select({ status: ingestionRun.status })
          .from(ingestionRun)
          .where(eq(ingestionRun.id, runId))
          .limit(1);
        if (existingRun) {
          return existingRun.status === "running"
            ? { status: "started" as const, runId }
            : { status: "deduplicated" as const, activeRunId: runId };
        }

        const inserted = await tx.run(sql`
          insert into ingestion_run (id, source, status, started_at)
          select ${runId}, 'all', 'running', ${startedAt.getTime()}
          where not exists (
            select 1 from ingestion_run
            where status = 'running' and started_at >= ${lockCutoff}
          )
        `);
        if (inserted.rowsAffected === 0) {
          const [activeRun] = await tx
            .select({ id: ingestionRun.id })
            .from(ingestionRun)
            .where(
              and(
                eq(ingestionRun.status, "running"),
                sql`${ingestionRun.startedAt} >= ${lockCutoff}`,
              ),
            )
            .limit(1);
          return {
            status: "deduplicated" as const,
            activeRunId: activeRun?.id ?? null,
          };
        }

        for (const initialCursor of DURABLE_INITIAL_SOURCE_CURSORS) {
          const source = initialCursor.source;
          const cursor = serializeDurableSourceCursor(initialCursor);
          await tx.insert(ingestionSourceRun).values({
            id: sourceRunId(runId, source),
            runId,
            source,
            status: "running",
            startCursor: cursor,
            nextCursor: cursor,
            pagesProcessed: 0,
            vehiclesProcessed: 0,
            startedAt,
          });
        }
        return { status: "started" as const, runId };
      });
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
      const id = sourceRunId(params.runId, source);
      return database.transaction(async (tx) => {
        const [current] = await tx
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
          !durableSourceCursorEquals(
            currentResult.cursor,
            params.requestedCursor,
          )
        ) {
          return currentResult;
        }

        for (
          let start = 0;
          start < params.fetched.vehicles.length;
          start += SNAPSHOT_WRITE_BATCH_SIZE
        ) {
          const batch = params.fetched.vehicles.slice(
            start,
            start + SNAPSHOT_WRITE_BATCH_SIZE,
          );
          if (batch.length === 0) continue;
          await tx
            .insert(vehicleSnapshot)
            .values(
              batch.map((vehicle) => toSnapshotRow(params.runId, vehicle)),
            )
            .onConflictDoNothing();
        }

        const errors = deduplicateErrors([
          ...parseIngestionErrors(current.errors),
          ...params.fetched.errors,
        ]);
        const vehiclesProcessed =
          current.vehiclesProcessed + params.fetched.vehiclesProcessed;
        const pagesProcessed =
          current.pagesProcessed + params.fetched.pagesProcessed;
        const terminal = params.fetched.status !== "paused";
        const status: SourceRunStatus =
          params.fetched.status === "paused"
            ? "running"
            : params.fetched.status === "complete"
              ? "success"
              : statusForFailedSource(vehiclesProcessed);

        await tx
          .update(ingestionSourceRun)
          .set({
            status,
            nextCursor: serializeDurableSourceCursor(params.fetched.cursor),
            pagesProcessed,
            vehiclesProcessed,
            errors: errors.length > 0 ? JSON.stringify(errors) : null,
            completedAt: terminal ? new Date() : null,
          })
          .where(eq(ingestionSourceRun.id, id));

        return {
          cursor: params.fetched.cursor,
          status: params.fetched.status,
          count: vehiclesProcessed,
          pagesProcessed,
          errors,
        };
      });
    },

    async markSourceFailed<Source extends DurableIngestionSource>(params: {
      runId: string;
      source: Source;
      message: string;
    }): Promise<DurableSourceChunkResult<Source>> {
      const id = sourceRunId(params.runId, params.source);
      return database.transaction(async (tx) => {
        const [current] = await tx
          .select()
          .from(ingestionSourceRun)
          .where(eq(ingestionSourceRun.id, id))
          .limit(1);
        if (!current) throw new Error(`Cannot fail missing source run ${id}.`);
        if (current.status !== "running")
          return toChunkResult(params.source, current);

        const errors = deduplicateErrors([
          ...parseIngestionErrors(current.errors),
          params.message,
        ]);
        const status: SourceRunStatus =
          current.vehiclesProcessed > 0 ? "partial" : "error";
        await tx
          .update(ingestionSourceRun)
          .set({
            status,
            errors: JSON.stringify(errors),
            completedAt: new Date(),
          })
          .where(eq(ingestionSourceRun.id, id));
        return {
          ...toChunkResult(params.source, current),
          status: "failed",
          errors,
        };
      });
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

    async loadSourceSnapshots(
      runId: string,
      source: DurableIngestionSource,
    ): Promise<Map<string, CanonicalVehicle>> {
      const vehicles = new Map<string, CanonicalVehicle>();
      let offset = 0;
      while (true) {
        const rows = await database
          .select()
          .from(vehicleSnapshot)
          .where(
            and(
              eq(vehicleSnapshot.runId, runId),
              eq(vehicleSnapshot.source, source),
            ),
          )
          .orderBy(asc(vehicleSnapshot.vin))
          .limit(SNAPSHOT_READ_BATCH_SIZE)
          .offset(offset);
        for (const row of rows) vehicles.set(row.vin, snapshotToVehicle(row));
        if (rows.length < SNAPSHOT_READ_BATCH_SIZE) break;
        offset += rows.length;
      }
      return vehicles;
    },

    async markRunFailed(runId: string, message: string): Promise<void> {
      await database.transaction(async (tx) => {
        const [run] = await tx
          .select({ errors: ingestionRun.errors })
          .from(ingestionRun)
          .where(eq(ingestionRun.id, runId))
          .limit(1);
        const runErrors = deduplicateErrors([
          ...parseIngestionErrors(run?.errors ?? null),
          message,
        ]);
        const sourceRows = await tx
          .select()
          .from(ingestionSourceRun)
          .where(eq(ingestionSourceRun.runId, runId));
        const completedAt = new Date();
        for (const sourceRow of sourceRows) {
          if (sourceRow.status !== "running") continue;
          const errors = deduplicateErrors([
            ...parseIngestionErrors(sourceRow.errors),
            message,
          ]);
          await tx
            .update(ingestionSourceRun)
            .set({
              status: sourceRow.vehiclesProcessed > 0 ? "partial" : "error",
              errors: JSON.stringify(errors),
              completedAt,
            })
            .where(eq(ingestionSourceRun.id, sourceRow.id));
        }
        await tx
          .update(ingestionRun)
          .set({
            status: "error",
            errors: JSON.stringify(runErrors),
            completedAt,
          })
          .where(eq(ingestionRun.id, runId));
        await tx
          .delete(vehicleSnapshot)
          .where(eq(vehicleSnapshot.runId, runId));
      });
    },

    cleanupSnapshots(runId: string) {
      return database
        .delete(vehicleSnapshot)
        .where(eq(vehicleSnapshot.runId, runId))
        .then(() => undefined);
    },

    async cleanupStaleSnapshots(): Promise<void> {
      const cutoff = Date.now() - STALE_SNAPSHOT_RETENTION_MS;
      await database.run(sql`
        delete from vehicle_snapshot
        where run_id in (
          select id from ingestion_run
          where status != 'running' or started_at < ${cutoff}
        )
      `);
    },
  };
}

export type DurableIngestionRepository = ReturnType<
  typeof createDurableIngestionRepository
>;
