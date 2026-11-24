import { VANDERHAAGS_MINIMUM_BY_YARD } from "./vanderhaags-yards";
import { HARRYS_MINIMUM_BY_YARD } from "./harrys-yard-metadata";
import { validateAutorecyclerPublishedInventory } from "./autorecycler-published-inventory";
import { urgiisPublication } from "./urgiis-publication";
import { hollanderstoresPreservedYards } from "./hollanderstores-durable-cursor";
import { HOLLANDERSTORES_YARDS } from "./hollanderstores-yard-metadata";
import { validatePublishedYardInventory } from "./published-yard-inventory";
import { and, count, eq, inArray, isNull, notInArray } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import {
  isIngestionSource,
  type IngestionSource,
} from "~/lib/ingestion-source";
import { ingestionRun, ingestionSourceRun, vehicle } from "~/schema";
import { parseIngestionErrors } from "./durable-ingestion-repository";
import type { IngestionSnapshotStore } from "./ingestion-snapshot-store";
import { loadSourceSnapshot } from "./run-snapshot-inventory";
import { SourcePublication } from "./source-publication";
import { validateCars4PartsPublishedYardInventory } from "./cars4parts-published-inventory";
import {
  parseAcceptedSources,
  parseDurableRunStage,
} from "./durable-run-state";
import {
  isDurableSourceCursorTerminal,
  parseDurableSourceCursor,
} from "./durable-source";
import {
  newestVehicleArrival,
  validateSourceSnapshot,
} from "./source-validation";

type RejectedSources = Array<{ source: IngestionSource; errors: string[] }>;

/**
 * ready: the run joined the commit queue with its accepted sources.
 * released: no source was accepted, so the run had nothing to commit and
 * released its sources' slots at validation, without queueing for the
 * commit. Its sources retry within their daily attempts.
 */
export type DurableSourceValidationSummary =
  | { status: "stopped" }
  | {
      status: "ready";
      acceptedSources: IngestionSource[];
      rejectedSources: RejectedSources;
    }
  | {
      status: "released";
      acceptedSources: [];
      rejectedSources: RejectedSources;
    };

export async function validateDurableSourceRuns(params: {
  runId: string;
  database: LibSQLDatabase;
  batchClient: Pick<Client, "batch">;
  snapshotStore: IngestionSnapshotStore;
  /** Defaults to the current time. */
  now?: Date;
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
  const snapshotBySource = new Map<
    string,
    { uniqueVehicles: number; newestVehicleDate: Date | null }
  >();
  const yardErrorsBySource = new Map<string, string[]>();
  // Floors and drift baselines over only the yards a source publishes.
  const scopedLimits = new Map<string, { minimum: number; previous: number }>();
  const autorecyclerBaselines = new Map<string, number>();
  for (const row of sourceRows) {
    const snapshot = await loadSourceSnapshot(
      params.snapshotStore,
      row.snapshotChunks,
    );
    snapshotBySource.set(row.source, {
      uniqueVehicles: snapshot.vehicles.size,
      newestVehicleDate: newestVehicleArrival(
        snapshot.vehicles.values(),
        run.startedAt,
      ),
    });
    if (
      row.source === "autorecycler" &&
      row.status === "success" &&
      isDurableSourceCursorTerminal(row.source, row.nextCursor)
    ) {
      const cursor = parseDurableSourceCursor(
        "autorecycler",
        row.nextCursor ?? "",
      );
      if (cursor.phase === "complete" && cursor.freshness) {
        const validation = await validateAutorecyclerPublishedInventory(
          params.database,
          snapshot.vehicles.values(),
          cursor.freshness.eligibleYards,
          cursor.freshness.preservedYards,
        );
        yardErrorsBySource.set(row.source, validation.errors);
        autorecyclerBaselines.set(row.source, validation.previousEligibleCount);
      }
    }
    if (
      row.source === "vanderhaags" &&
      row.status === "success" &&
      isDurableSourceCursorTerminal(row.source, row.nextCursor)
    )
      yardErrorsBySource.set(
        row.source,
        await validatePublishedYardInventory(
          params.database,
          snapshot.vehicles.values(),
          "vanderhaags",
          VANDERHAAGS_MINIMUM_BY_YARD,
        ),
      );
    if (
      row.source === "cars4parts" &&
      row.status === "success" &&
      isDurableSourceCursorTerminal(row.source, row.nextCursor)
    )
      yardErrorsBySource.set(
        row.source,
        await validateCars4PartsPublishedYardInventory(
          params.database,
          snapshot.vehicles.values(),
        ),
      );
    if (
      row.source === "harrys" &&
      row.status === "success" &&
      isDurableSourceCursorTerminal(row.source, row.nextCursor)
    )
      yardErrorsBySource.set(
        row.source,
        await validatePublishedYardInventory(
          params.database,
          snapshot.vehicles.values(),
          "harrys",
          HARRYS_MINIMUM_BY_YARD,
        ),
      );
    if (
      row.source === "hollanderstores" &&
      row.status === "success" &&
      isDurableSourceCursorTerminal(row.source, row.nextCursor)
    ) {
      const preserved = hollanderstoresPreservedYards(
        parseDurableSourceCursor("hollanderstores", row.nextCursor ?? ""),
      );
      // Preserved yards keep their previous inventory, so they count toward
      // neither this run's floor nor its drift baseline.
      if (preserved.size > 0) {
        const [baseline] = await params.database
          .select({ count: count() })
          .from(vehicle)
          .where(
            and(
              eq(vehicle.source, "hollanderstores"),
              isNull(vehicle.missingSinceAt),
              notInArray(vehicle.locationCode, [...preserved]),
            ),
          );
        scopedLimits.set(row.source, {
          minimum: HOLLANDERSTORES_YARDS.filter(
            (yard) => !preserved.has(yard.code),
          ).reduce((sum, yard) => sum + yard.minimum, 0),
          previous: baseline?.count ?? 0,
        });
      }
    }
    if (
      row.source === "urgiis" &&
      row.status === "success" &&
      isDurableSourceCursorTerminal(row.source, row.nextCursor)
    ) {
      const cursor = parseDurableSourceCursor("urgiis", row.nextCursor ?? "");
      const scope = urgiisPublication(cursor);
      const [baseline] = await params.database
        .select({ count: count() })
        .from(vehicle)
        .where(
          and(
            eq(vehicle.source, "urgiis"),
            isNull(vehicle.missingSinceAt),
            inArray(vehicle.locationCode, [...scope.minimumByYard.keys()]),
          ),
        );
      scopedLimits.set(row.source, {
        minimum: scope.minimum,
        previous: baseline?.count ?? 0,
      });
      yardErrorsBySource.set(
        row.source,
        await validatePublishedYardInventory(
          params.database,
          snapshot.vehicles.values(),
          "urgiis",
          scope.minimumByYard,
          scope.preservedYards,
        ),
      );
      if (!cursor.completed.some((c) => "accepted" in c))
        yardErrorsBySource.set(row.source, [
          "URG IIS has no publishing tenants; prior inventory is preserved",
        ]);
    }
  }

  const validations: Array<{
    source: IngestionSource;
    uniqueVehicles: number;
    duplicateVehicles: number;
    status: "accepted" | "rejected";
    errors: string[];
    deterministic: boolean;
  }> = [];
  for (const row of sourceRows) {
    if (!isIngestionSource(row.source)) continue;
    const previous = await SourcePublication.latestAccepted(
      params.database,
      row.source,
      { excludeRunId: params.runId },
    );
    const snapshot = snapshotBySource.get(row.source);
    const uniqueVehicles = snapshot?.uniqueVehicles ?? 0;
    const duplicateVehicles = Math.max(
      row.duplicateVehicles,
      row.vehiclesProcessed - uniqueVehicles - row.rejectedVehicles,
    );
    const validation = validateSourceSnapshot({
      source: row.source,
      terminal:
        row.status === "success" &&
        isDurableSourceCursorTerminal(row.source, row.nextCursor),
      uniqueVehicles,
      vehiclesProcessed: row.vehiclesProcessed,
      duplicateVehicles,
      rejectedVehicles: row.rejectedVehicles,
      errors: [
        ...parseIngestionErrors(row.errors),
        ...(yardErrorsBySource.get(row.source) ?? []),
      ],
      minimumUniqueInventory: scopedLimits.get(row.source)?.minimum,
      previousAcceptedCount:
        scopedLimits.get(row.source)?.previous ??
        autorecyclerBaselines.get(row.source) ??
        previous?.uniqueVehicles ??
        null,
      newestVehicleDate: snapshot?.newestVehicleDate ?? null,
      validatedAt: run.startedAt,
    });
    validations.push({
      source: row.source,
      uniqueVehicles,
      duplicateVehicles,
      status: validation.status,
      errors: validation.errors,
      deterministic: row.status === "success" || row.validationErrors !== null,
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
      validation.deterministic && validation.errors.length > 0
        ? JSON.stringify(validation.errors)
        : null,
      params.runId,
      validation.source,
      params.runId,
    ],
  }));
  const errors = [...parseIngestionErrors(current.errors), ...validationErrors];
  const errorsJson =
    errors.length > 0 ? JSON.stringify([...new Set(errors)]) : null;
  const checkpointIndex = statements.length;
  const now = (params.now ?? new Date()).getTime();
  statements.push(
    acceptedSources.length === 0
      ? releaseStatement(params.runId, errorsJson, now)
      : {
          // The run joins the commit queue (CommitLease) in this order.
          sql: `
            update ingestion_run
            set stage = 'reconcile_upsert', accepted_sources = ?,
                reconciliation_cursor = null, errors = ?, last_progress_at = ?,
                ready_at = ?
            where id = ? and status = 'running' and active_slot = 1
              and stage = 'sources'
          `,
          args: [
            JSON.stringify(acceptedSources),
            errorsJson,
            now,
            now,
            params.runId,
          ],
        },
  );
  const results = await params.batchClient.batch(statements, "write");
  const checkpoint = results[checkpointIndex];
  if (!checkpoint) {
    throw new Error(`Source validation ${params.runId} had no checkpoint.`);
  }
  if (checkpoint.rowsAffected === 0) return { status: "stopped" };

  return acceptedSources.length === 0
    ? { status: "released", acceptedSources: [], rejectedSources }
    : { status: "ready", acceptedSources, rejectedSources };
}

/**
 * Ends a run whose every source failed or was rejected. It has nothing to
 * commit: reconciling no accepted source writes no vehicle and refreshes no
 * yard, and the retired sources it would age are reconciled by the next run
 * that commits. So it never queues for the commit, whose holder can keep it
 * for hours, and its source's slot frees at once for the day's retries.
 *
 * It never claimed the commit, so any search rebuild it inherited at start
 * still sits on the finished run it came from, and the next run to claim the
 * commit takes it on. Clearing it here keeps a release during a rebuild from
 * ordering another one.
 */
function releaseStatement(
  runId: string,
  errorsJson: string | null,
  now: number,
): InStatement {
  return {
    sql: `
      update ingestion_run
      set status = 'error', stage = 'released', active_slot = null,
          accepted_sources = '[]', reconciliation_cursor = null, errors = ?,
          full_reindex_required = 0, last_progress_at = ?, completed_at = ?,
          released_at = ?
      where id = ? and status = 'running' and active_slot = 1
        and stage = 'sources'
    `,
    args: [errorsJson, now, now, now, runId],
  };
}
import type { Client, InStatement } from "@libsql/client";
