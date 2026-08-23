import { and, desc, eq, ne, sql } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import {
  isIngestionSource,
  type IngestionSource,
} from "~/lib/ingestion-source";
import { ingestionRun, ingestionSourceRun, vehicleSnapshot } from "~/schema";
import { parseIngestionErrors } from "./durable-ingestion-repository";
import {
  parseAcceptedSources,
  parseDurableRunStage,
} from "./durable-run-state";
import { parseDurableSourceCursor } from "./durable-source";
import { validateSourceSnapshot } from "./source-validation";

export type DurableSourceValidationSummary =
  | { status: "stopped" }
  | {
      status: "ready";
      acceptedSources: IngestionSource[];
      rejectedSources: Array<{ source: IngestionSource; errors: string[] }>;
    };

function hasTerminalCursor(source: IngestionSource, cursor: string | null) {
  if (!cursor) return false;
  try {
    parseDurableSourceCursor(source, cursor);
    return true;
  } catch {
    return false;
  }
}

export async function validateDurableSourceRuns(params: {
  runId: string;
  database: LibSQLDatabase;
  batchClient: Pick<Client, "batch">;
}): Promise<DurableSourceValidationSummary> {
  const [run] = await params.database
    .select()
    .from(ingestionRun)
    .where(eq(ingestionRun.id, params.runId))
    .limit(1);
  if (!run) throw new Error(`Ingestion run ${params.runId} does not exist.`);
  if (run.status !== "running" || run.activeSlot !== 1) {
    return { status: "stopped" };
  }
  const stage = parseDurableRunStage(run.stage);
  if (stage !== "sources") {
    return {
      status: "ready",
      acceptedSources: parseAcceptedSources(run.acceptedSources),
      rejectedSources: [],
    };
  }

  const sourceRows = await params.database
    .select()
    .from(ingestionSourceRun)
    .where(eq(ingestionSourceRun.runId, params.runId));
  if (sourceRows.some((row) => row.status === "running")) {
    throw new Error(
      `Cannot validate ingestion run ${params.runId} before every source is terminal.`,
    );
  }
  const exactCounts = await params.database
    .select({
      source: vehicleSnapshot.source,
      count: sql<number>`count(*)`,
    })
    .from(vehicleSnapshot)
    .where(eq(vehicleSnapshot.runId, params.runId))
    .groupBy(vehicleSnapshot.source);
  const countBySource = new Map(
    exactCounts
      .filter((row) => isIngestionSource(row.source))
      .map((row) => [row.source, row.count] as const),
  );

  const validations: Array<{
    source: IngestionSource;
    uniqueVehicles: number;
    duplicateVehicles: number;
    status: "accepted" | "rejected";
    errors: string[];
  }> = [];
  for (const row of sourceRows) {
    if (!isIngestionSource(row.source)) continue;
    const [previous] = await params.database
      .select({ count: ingestionSourceRun.uniqueVehicles })
      .from(ingestionSourceRun)
      .innerJoin(ingestionRun, eq(ingestionRun.id, ingestionSourceRun.runId))
      .where(
        and(
          eq(ingestionSourceRun.source, row.source),
          eq(ingestionSourceRun.acceptanceStatus, "accepted"),
          ne(ingestionSourceRun.runId, params.runId),
          sql`${ingestionRun.searchPublishedAt} is not null`,
        ),
      )
      .orderBy(desc(ingestionRun.searchPublishedAt))
      .limit(1);
    const uniqueVehicles = countBySource.get(row.source) ?? 0;
    const duplicateVehicles = Math.max(
      row.duplicateVehicles,
      row.vehiclesProcessed - uniqueVehicles - row.rejectedVehicles,
    );
    const validation = validateSourceSnapshot({
      source: row.source,
      terminal:
        row.status === "success" &&
        hasTerminalCursor(row.source, row.nextCursor),
      uniqueVehicles,
      vehiclesProcessed: row.vehiclesProcessed,
      duplicateVehicles,
      rejectedVehicles: row.rejectedVehicles,
      errors: parseIngestionErrors(row.errors),
      previousAcceptedCount: previous?.count ?? null,
    });
    validations.push({
      source: row.source,
      uniqueVehicles,
      duplicateVehicles,
      status: validation.status,
      errors: validation.errors,
    });
  }

  const acceptedSources = validations
    .filter((validation) => validation.status === "accepted")
    .map((validation) => validation.source);
  const rejectedSources = validations
    .filter((validation) => validation.status === "rejected")
    .map(({ source, errors }) => ({ source, errors }));
  const validationErrors = rejectedSources.flatMap(({ errors }) => errors);

  const [current] = await params.database
    .select({
      stage: ingestionRun.stage,
      status: ingestionRun.status,
      activeSlot: ingestionRun.activeSlot,
      errors: ingestionRun.errors,
    })
    .from(ingestionRun)
    .where(eq(ingestionRun.id, params.runId))
    .limit(1);
  if (
    !current ||
    current.status !== "running" ||
    current.activeSlot !== 1 ||
    parseDurableRunStage(current.stage) !== "sources"
  ) {
    return { status: "stopped" };
  }

  const statements: InStatement[] = validations.map((validation) => ({
    sql: `
      update ingestion_source_run
      set unique_vehicles = ?, duplicate_vehicles = ?,
          acceptance_status = ?, validation_errors = ?
      where run_id = ? and source = ?
        and exists (
          select 1 from ingestion_run
          where id = ? and status = 'running' and active_slot = 1
            and stage = 'sources'
        )
    `,
    args: [
      validation.uniqueVehicles,
      validation.duplicateVehicles,
      validation.status,
      validation.errors.length > 0 ? JSON.stringify(validation.errors) : null,
      params.runId,
      validation.source,
      params.runId,
    ],
  }));
  const errors = [...parseIngestionErrors(current.errors), ...validationErrors];
  const checkpointIndex = statements.length;
  statements.push({
    sql: `
      update ingestion_run
      set stage = 'reconcile_upsert', accepted_sources = ?,
          reconciliation_cursor = null, errors = ?, last_progress_at = ?
      where id = ? and status = 'running' and active_slot = 1
        and stage = 'sources'
    `,
    args: [
      JSON.stringify(acceptedSources),
      errors.length > 0 ? JSON.stringify([...new Set(errors)]) : null,
      Date.now(),
      params.runId,
    ],
  });
  const results = await params.batchClient.batch(statements, "write");
  const checkpoint = results[checkpointIndex];
  if (!checkpoint) {
    throw new Error(`Source validation ${params.runId} had no checkpoint.`);
  }
  if (checkpoint.rowsAffected === 0) return { status: "stopped" };

  return { status: "ready", acceptedSources, rejectedSources };
}
import type { Client, InStatement } from "@libsql/client";
