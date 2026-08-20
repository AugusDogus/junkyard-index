import { Effect } from "effect";
import type { db } from "~/lib/db";
import { isIngestionSource, mapIngestionSources } from "~/lib/ingestion-source";
import type { DurableIngestionRepository } from "./durable-ingestion-repository";
import { parseIngestionErrors } from "./durable-ingestion-repository";
import type { DurableIngestionResult } from "./durable-ingestion-types";
import {
  DURABLE_INGESTION_SOURCES,
  type DurableIngestionSource,
} from "./durable-source";
import {
  determineHealthySources,
  shouldAdvanceMissingState,
  type PipelineSourceOutcome,
} from "./pipeline-policy";
import {
  buildFinalInventoryByVin,
  reconcileAndCompleteRunFromFinalInventory,
  type MissingStatePolicy,
} from "./reconcile";
import { Database, runIngestionEffect } from "./runtime";
import type { CanonicalVehicle } from "./types";

const MISSING_DELETE_AFTER_RUNS = 3;
const MISSING_DELETE_AFTER_MS = 3 * 24 * 60 * 60 * 1000;

export async function reconcileDurableIngestionRun(params: {
  runId: string;
  repository: DurableIngestionRepository;
  database: typeof db;
}): Promise<DurableIngestionResult> {
  const run = await params.repository.getRun(params.runId);
  const sourceRows = await params.repository.getSourceRuns(params.runId);
  const sourceRowsByName = new Map(
    sourceRows
      .filter((row) => isIngestionSource(row.source))
      .map((row) => [row.source, row] as const),
  );
  const outcomes: PipelineSourceOutcome[] = DURABLE_INGESTION_SOURCES.map(
    (source) => {
      const row = sourceRowsByName.get(source);
      if (!row) {
        return {
          source,
          count: 0,
          errors: [`Source run ${params.runId}:${source} is missing`],
        };
      }
      if (row.status === "running") {
        return {
          source,
          count: row.vehiclesProcessed,
          errors: [`Source ${source} did not reach a terminal state`],
        };
      }
      return {
        source,
        count: row.vehiclesProcessed,
        errors: parseIngestionErrors(row.errors),
      };
    },
  );
  const countFor = (source: DurableIngestionSource): number =>
    outcomes.find((outcome) => outcome.source === source)?.count ?? 0;
  const toResult = (values: {
    totalUpserted: number;
    totalDeleted: number;
    errors: string[];
    completedAt: Date;
  }): DurableIngestionResult => ({
    runId: params.runId,
    totalUpserted: values.totalUpserted,
    totalDeleted: values.totalDeleted,
    counts: mapIngestionSources(countFor),
    errors: values.errors,
    durationMs: values.completedAt.getTime() - run.startedAt.getTime(),
  });

  if (run.status === "success") {
    return toResult({
      totalUpserted: run.vehiclesUpserted ?? 0,
      totalDeleted: run.vehiclesDeleted ?? 0,
      errors: parseIngestionErrors(run.errors),
      completedAt: run.completedAt ?? new Date(),
    });
  }

  const healthySources = determineHealthySources(outcomes);
  const snapshotEntries = await Promise.all(
    DURABLE_INGESTION_SOURCES.map(
      async (
        source,
      ): Promise<
        readonly [DurableIngestionSource, Map<string, CanonicalVehicle>]
      > => [
        source,
        healthySources.includes(source)
          ? await params.repository.loadSourceSnapshots(params.runId, source)
          : new Map<string, CanonicalVehicle>(),
      ],
    ),
  );
  const snapshots = new Map(snapshotEntries);
  const finalInventoryByVin = buildFinalInventoryByVin({
    healthySources,
    inventoryBySource: snapshots,
  });
  const coreOutcomes = outcomes.filter(
    (outcome) =>
      outcome.source === "row52" ||
      outcome.source === "pyp" ||
      outcome.source === "autorecycler",
  );
  const [firstHealthySource, ...remainingHealthySources] = healthySources;
  const missingStatePolicy: MissingStatePolicy =
    shouldAdvanceMissingState(coreOutcomes) && firstHealthySource
      ? {
          kind: "advance",
          eligibleSources: [firstHealthySource, ...remainingHealthySources],
        }
      : { kind: "skip" };
  const completedAt = new Date();
  const errors = outcomes.flatMap((outcome) => outcome.errors);
  const reconciled = await runIngestionEffect(
    reconcileAndCompleteRunFromFinalInventory({
      runId: params.runId,
      runTimestamp: completedAt,
      finalInventoryByVin,
      missingStatePolicy,
      missingDeleteAfterRuns: MISSING_DELETE_AFTER_RUNS,
      missingDeleteAfterMs: MISSING_DELETE_AFTER_MS,
      runCompletion: { errors },
    }).pipe(Effect.provideService(Database, params.database)),
  );
  return toResult({
    totalUpserted: reconciled.upsertedCount,
    totalDeleted: reconciled.deletedCount,
    errors,
    completedAt,
  });
}
