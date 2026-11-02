import type { Client, InStatement, InValue } from "@libsql/client";
import { and, asc, eq, gt, inArray, sql } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { mapIngestionSources } from "~/lib/ingestion-source";
import { ingestionRun, ingestionSourceRun, vehicle } from "~/schema";
import { parseIngestionErrors } from "./durable-ingestion-repository";
import type {
  DurableIngestionResult,
  DurableReconciliationBatchResult,
} from "./durable-ingestion-types";
import {
  parseAcceptedSources,
  parseDurableRunStage,
} from "./durable-run-state";
import { DURABLE_INGESTION_SOURCES } from "./durable-source";
import type { IngestionSnapshotStore } from "./ingestion-snapshot-store";
import {
  type MissingVehicleTransition,
  planChangedVehicleUpserts,
  planMissingVehicleTransitions,
} from "./reconciliation-policy";
import {
  loadRunSnapshotInventory,
  type RunSnapshotInventory,
} from "./run-snapshot-inventory";
import type { CanonicalVehicle } from "./types";

const RECONCILIATION_BATCH_SIZE = 500;
const MISSING_DELETE_AFTER_RUNS = 3;
const MISSING_DELETE_AFTER_MS = 3 * 24 * 60 * 60 * 1000;
const VEHICLE_VALUE_COLUMN_COUNT = 29;

// Leave most of a workflow step's duration for the batches' own writes.
const RECONCILIATION_STEP_BUDGET_MS = 240_000;

type BatchClient = Pick<Client, "batch">;

interface ReconciliationContext {
  runId: string;
  database: LibSQLDatabase;
  batchClient: BatchClient;
  /** Loads the run's staged inventory at most once per step. */
  inventory: () => Promise<RunSnapshotInventory>;
}

/** Index of the first VIN after the cursor in ascending VIN order. */
function firstVinAfter(vins: readonly string[], cursor: string | null) {
  if (cursor === null) return 0;
  let low = 0;
  let high = vins.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if ((vins[middle] ?? "") <= cursor) low = middle + 1;
    else high = middle;
  }
  return low;
}

function guardSql(stage: "reconcile_upsert" | "reconcile_missing") {
  return `
    exists (
      select 1 from ingestion_run
      where id = ?
        and status = 'running'
        and active_slot = 1
        and stage = '${stage}'
        and reconciliation_cursor is ?
    )
  `;
}

function changeInsertStatement(params: {
  runId: string;
  stage: "reconcile_upsert" | "reconcile_missing";
  cursor: string | null;
  changes: Array<{ vin: string; changeType: "upsert" | "missing" | "delete" }>;
  now: number;
}): InStatement | null {
  if (params.changes.length === 0) return null;
  return {
    sql: `
      insert into vehicle_change_v2 (
        run_id, vin, change_type, payload, payload_version, created_at
      )
      select ?, column1, column2, null, 1, ?
      from (values ${params.changes.map(() => "(?, ?)").join(", ")})
      where ${guardSql(params.stage)}
      on conflict(run_id, vin, change_type)
        where processed_at is null
        do nothing
    `,
    args: [
      params.runId,
      params.now,
      ...params.changes.flatMap(({ vin, changeType }) => [vin, changeType]),
      params.runId,
      params.cursor,
    ],
  };
}

function toVehicleValues(params: {
  vehicle: CanonicalVehicle;
  firstSeenAt: Date;
  runTimestamp: Date;
}): InValue[] {
  const value = params.vehicle;
  return [
    value.vin,
    value.source,
    value.year,
    value.make,
    value.model,
    value.color,
    value.stockNumber,
    value.imageUrl,
    value.availableDate,
    value.locationCode,
    value.locationName,
    value.locationCity,
    value.state,
    value.stateAbbr,
    value.lat,
    value.lng,
    value.section,
    value.row,
    value.space,
    value.detailsUrl,
    value.partsUrl,
    value.pricesUrl,
    value.engine,
    value.trim,
    value.transmission,
    params.firstSeenAt.getTime(),
    params.runTimestamp.getTime(),
    null,
    0,
  ];
}

function vehicleUpsertStatement(params: {
  runId: string;
  cursor: string | null;
  rows: Array<{
    vehicle: CanonicalVehicle;
    firstSeenAt: Date;
    runTimestamp: Date;
  }>;
}): InStatement | null {
  if (params.rows.length === 0) return null;
  const placeholders = params.rows
    .map(
      () =>
        `(${Array.from({ length: VEHICLE_VALUE_COLUMN_COUNT }, () => "?").join(", ")})`,
    )
    .join(", ");
  const columns = Array.from(
    { length: VEHICLE_VALUE_COLUMN_COUNT },
    (_, index) => `column${index + 1}`,
  ).join(", ");
  return {
    sql: `
      insert into vehicle (
        vin, source, year, make, model, color, stock_number, image_url,
        available_date, location_code, location_name, location_city, state,
        state_abbr, lat, lng, section, row, space, details_url, parts_url,
        prices_url, engine, trim, transmission, first_seen_at, last_seen_at,
        missing_since_at, missing_run_count
      )
      select ${columns}
      from (values ${placeholders})
      where ${guardSql("reconcile_upsert")}
      on conflict(vin) do update set
        source = excluded.source,
        year = excluded.year,
        make = excluded.make,
        model = excluded.model,
        color = excluded.color,
        stock_number = excluded.stock_number,
        image_url = excluded.image_url,
        available_date = excluded.available_date,
        location_code = excluded.location_code,
        location_name = excluded.location_name,
        location_city = excluded.location_city,
        state = excluded.state,
        state_abbr = excluded.state_abbr,
        lat = excluded.lat,
        lng = excluded.lng,
        section = excluded.section,
        row = excluded.row,
        space = excluded.space,
        details_url = excluded.details_url,
        parts_url = excluded.parts_url,
        prices_url = excluded.prices_url,
        engine = excluded.engine,
        trim = excluded.trim,
        transmission = excluded.transmission,
        last_seen_at = excluded.last_seen_at,
        missing_since_at = null,
        missing_run_count = 0
    `,
    args: [
      ...params.rows.flatMap(toVehicleValues),
      params.runId,
      params.cursor,
    ],
  };
}

async function buildResult(
  runId: string,
  database: LibSQLDatabase,
): Promise<DurableIngestionResult> {
  let [run] = await database
    .select()
    .from(ingestionRun)
    .where(eq(ingestionRun.id, runId))
    .limit(1);
  if (!run) throw new Error(`Ingestion run ${runId} does not exist.`);
  if (
    run.inventoryPublishedAt &&
    (run.stage === "project_changes" || run.stage === "full_reindex_prepare") &&
    (run.publishedVehicleCount === null || run.publishedYardCount === null)
  ) {
    const [inventory] = await database
      .select({
        vehicleCount: sql<number>`count(*)`,
        yardCount: sql<number>`count(distinct ${vehicle.locationCode})`,
      })
      .from(vehicle);
    if (!inventory) {
      throw new Error(
        `Counting published inventory for ${runId} returned no result.`,
      );
    }
    await database
      .update(ingestionRun)
      .set({
        publishedVehicleCount: inventory.vehicleCount,
        publishedYardCount: inventory.yardCount,
      })
      .where(
        and(
          eq(ingestionRun.id, runId),
          eq(ingestionRun.status, "running"),
          eq(ingestionRun.activeSlot, 1),
          inArray(ingestionRun.stage, [
            "project_changes",
            "full_reindex_prepare",
          ]),
        ),
      );
    [run] = await database
      .select()
      .from(ingestionRun)
      .where(eq(ingestionRun.id, runId))
      .limit(1);
    if (!run) throw new Error(`Ingestion run ${runId} does not exist.`);
  }
  const sourceRows = await database
    .select()
    .from(ingestionSourceRun)
    .where(eq(ingestionSourceRun.runId, runId));
  const countFor = (source: (typeof DURABLE_INGESTION_SOURCES)[number]) =>
    sourceRows.find((row) => row.source === source)?.uniqueVehicles ?? 0;
  return {
    runId,
    totalUpserted: run.vehiclesUpserted ?? 0,
    totalDeleted: run.vehiclesDeleted ?? 0,
    counts: mapIngestionSources(countFor),
    errors: parseIngestionErrors(run.errors),
    durationMs:
      (run.inventoryPublishedAt ?? new Date()).getTime() -
      run.startedAt.getTime(),
  };
}

async function runUpsertBatch(
  params: ReconciliationContext & {
    cursor: string | null;
    runTimestamp: Date;
  },
): Promise<DurableReconciliationBatchResult> {
  const inventory = await params.inventory();
  const start = firstVinAfter(inventory.vins, params.cursor);
  const rows = inventory.vins
    .slice(start, start + RECONCILIATION_BATCH_SIZE)
    .flatMap((vin) => {
      const snapshot = inventory.vehicles.get(vin);
      return snapshot ? [snapshot] : [];
    });

  const finalInventory = new Map(
    rows.map((snapshot) => [snapshot.vin, snapshot] as const),
  );
  const vins = [...finalInventory.keys()];
  const existingRows =
    vins.length === 0
      ? []
      : await params.database
          .select()
          .from(vehicle)
          .where(inArray(vehicle.vin, vins));
  const changed = planChangedVehicleUpserts({
    inventory: finalInventory,
    existingRows,
    runTimestamp: params.runTimestamp,
  });
  const nextCursor = rows.at(-1)?.vin ?? params.cursor;
  const nextStage =
    rows.length < RECONCILIATION_BATCH_SIZE
      ? "reconcile_missing"
      : "reconcile_upsert";
  const now = Date.now();
  const statements: InStatement[] = [];
  const changes = changeInsertStatement({
    runId: params.runId,
    stage: "reconcile_upsert",
    cursor: params.cursor,
    changes: changed.map(({ vehicle: changedVehicle }) => ({
      vin: changedVehicle.vin,
      changeType: "upsert",
    })),
    now,
  });
  if (changes) statements.push(changes);
  const upserts = vehicleUpsertStatement({
    runId: params.runId,
    cursor: params.cursor,
    rows: changed.map((entry) => ({
      ...entry,
      runTimestamp: params.runTimestamp,
    })),
  });
  if (upserts) statements.push(upserts);
  const checkpointIndex = statements.length;
  statements.push({
    sql: `
      update ingestion_run
      set stage = ?,
          reconciliation_cursor = ?,
          vehicles_upserted = coalesce(vehicles_upserted, 0) + ?,
          last_progress_at = ?
      where id = ?
        and status = 'running'
        and stage = 'reconcile_upsert'
        and reconciliation_cursor is ?
    `,
    args: [
      nextStage,
      nextStage === "reconcile_missing" ? null : nextCursor,
      changed.length,
      now,
      params.runId,
      params.cursor,
    ],
  });
  const results = await params.batchClient.batch(statements, "write");
  const checkpoint = results[checkpointIndex];
  if (!checkpoint) {
    throw new Error(
      `Upsert reconciliation for ${params.runId} returned no checkpoint.`,
    );
  }
  if (checkpoint.rowsAffected !== 0 && checkpoint.rowsAffected !== 1) {
    throw new Error(
      `Upsert reconciliation for ${params.runId} affected ${checkpoint.rowsAffected} checkpoints.`,
    );
  }
  if (checkpoint.rowsAffected === 0) {
    return reconcileBatch(params);
  }
  return {
    status: "paused",
    phase: nextStage === "reconcile_missing" ? "missing" : "upsert",
    cursor: nextStage === "reconcile_missing" ? null : nextCursor,
  };
}

function missingUpdateStatement(params: {
  runId: string;
  cursor: string | null;
  transitions: MissingVehicleTransition[];
}): InStatement | null {
  const missing = params.transitions.filter(
    (transition) => transition.changeType === "missing",
  );
  if (missing.length === 0) return null;
  return {
    sql: `
      update vehicle
      set missing_since_at = case vin ${missing.map(() => "when ? then ?").join(" ")} else missing_since_at end,
          missing_run_count = case vin ${missing.map(() => "when ? then ?").join(" ")} else missing_run_count end
      where vin in (${missing.map(() => "?").join(", ")})
        and ${guardSql("reconcile_missing")}
    `,
    args: [
      ...missing.flatMap((transition) => [
        transition.vin,
        transition.missingSinceAt,
      ]),
      ...missing.flatMap((transition) => [
        transition.vin,
        transition.missingRunCount,
      ]),
      ...missing.map((transition) => transition.vin),
      params.runId,
      params.cursor,
    ],
  };
}

function deleteStatement(params: {
  runId: string;
  cursor: string | null;
  transitions: MissingVehicleTransition[];
}): InStatement | null {
  const vins = params.transitions
    .filter((transition) => transition.changeType === "delete")
    .map((transition) => transition.vin);
  if (vins.length === 0) return null;
  return {
    sql: `
      delete from vehicle
      where vin in (${vins.map(() => "?").join(", ")})
        and ${guardSql("reconcile_missing")}
    `,
    args: [...vins, params.runId, params.cursor],
  };
}

async function runMissingBatch(
  params: ReconciliationContext & {
    cursor: string | null;
    runTimestamp: Date;
    acceptedSources: string[];
  },
): Promise<DurableReconciliationBatchResult> {
  const rows =
    params.cursor === null
      ? await params.database
          .select({
            vin: vehicle.vin,
            source: vehicle.source,
            missingSinceAt: vehicle.missingSinceAt,
            missingRunCount: vehicle.missingRunCount,
          })
          .from(vehicle)
          .orderBy(asc(vehicle.vin))
          .limit(RECONCILIATION_BATCH_SIZE)
      : await params.database
          .select({
            vin: vehicle.vin,
            source: vehicle.source,
            missingSinceAt: vehicle.missingSinceAt,
            missingRunCount: vehicle.missingRunCount,
          })
          .from(vehicle)
          .where(gt(vehicle.vin, params.cursor))
          .orderBy(asc(vehicle.vin))
          .limit(RECONCILIATION_BATCH_SIZE);
  const inventory = await params.inventory();
  const presentVins = new Set(
    rows
      .map((row) => row.vin)
      .filter(
        (vin) => inventory.vehicles.has(vin) || inventory.observedVins.has(vin),
      ),
  );
  const observedVins = rows
    .map((row) => row.vin)
    .filter((vin) => inventory.observedVins.has(vin));
  const observedSet = new Set(observedVins);
  const restoredVins = rows
    .filter(
      (row) =>
        observedSet.has(row.vin) &&
        (row.missingSinceAt !== null || (row.missingRunCount ?? 0) !== 0),
    )
    .map((row) => row.vin);
  const acceptedSources = new Set(params.acceptedSources);
  const transitions = planMissingVehicleTransitions({
    presentVins,
    existingRows: rows,
    runTimestamp: params.runTimestamp,
    acceptedSources,
    deleteAfterRuns: MISSING_DELETE_AFTER_RUNS,
    deleteAfterMs: MISSING_DELETE_AFTER_MS,
  });

  const finishing = rows.length < RECONCILIATION_BATCH_SIZE;
  const nextCursor = rows.at(-1)?.vin ?? params.cursor;
  const now = Date.now();
  const statements: InStatement[] = [];
  const changes = changeInsertStatement({
    runId: params.runId,
    stage: "reconcile_missing",
    cursor: params.cursor,
    changes: [
      ...transitions.map(({ vin, changeType }) => ({ vin, changeType })),
      ...restoredVins.map((vin) => ({ vin, changeType: "upsert" as const })),
    ],
    now,
  });
  if (changes) statements.push(changes);
  if (observedVins.length > 0) {
    statements.push({
      sql: `
        update vehicle
        set missing_since_at = null, missing_run_count = 0, last_seen_at = ?
        where vin in (${observedVins.map(() => "?").join(", ")})
          and ${guardSql("reconcile_missing")}
      `,
      args: [
        params.runTimestamp.getTime(),
        ...observedVins,
        params.runId,
        params.cursor,
      ],
    });
  }
  const missingUpdate = missingUpdateStatement({
    runId: params.runId,
    cursor: params.cursor,
    transitions,
  });
  if (missingUpdate) statements.push(missingUpdate);
  const deletes = deleteStatement({
    runId: params.runId,
    cursor: params.cursor,
    transitions,
  });
  if (deletes) statements.push(deletes);
  const checkpointIndex = statements.length;
  const deletedCount = transitions.filter(
    (transition) => transition.changeType === "delete",
  ).length;
  statements.push({
    sql: finishing
      ? `
          update ingestion_run
          set stage = case
                when full_reindex_required = 1 then 'full_reindex_prepare'
                else 'project_changes'
              end,
              reconciliation_cursor = null,
              vehicles_upserted = coalesce(vehicles_upserted, 0) + ?,
              vehicles_deleted = coalesce(vehicles_deleted, 0) + ?,
              inventory_outcome = case
                when (select count(*) from ingestion_source_run
                      where run_id = ? and acceptance_status = 'rejected') > 0
                  then 'published_degraded'
                else 'published'
              end,
              publication_sequence = (
                select coalesce(max(publication_sequence), 0) + 1
                from ingestion_run
                where publication_sequence is not null
              ),
              inventory_published_at = ?,
              last_progress_at = ?
          where id = ?
            and status = 'running'
            and active_slot = 1
            and stage = 'reconcile_missing'
            and reconciliation_cursor is ?
        `
      : `
          update ingestion_run
          set reconciliation_cursor = ?,
              vehicles_upserted = coalesce(vehicles_upserted, 0) + ?,
              vehicles_deleted = coalesce(vehicles_deleted, 0) + ?,
              last_progress_at = ?
          where id = ?
            and status = 'running'
            and active_slot = 1
            and stage = 'reconcile_missing'
            and reconciliation_cursor is ?
        `,
    args: finishing
      ? [
          restoredVins.length,
          deletedCount,
          params.runId,
          now,
          now,
          params.runId,
          params.cursor,
        ]
      : [
          nextCursor,
          restoredVins.length,
          deletedCount,
          now,
          params.runId,
          params.cursor,
        ],
  });
  const results = await params.batchClient.batch(statements, "write");
  const checkpoint = results[checkpointIndex];
  if (!checkpoint) {
    throw new Error(
      `Missing reconciliation for ${params.runId} returned no checkpoint.`,
    );
  }
  if (checkpoint.rowsAffected !== 0 && checkpoint.rowsAffected !== 1) {
    throw new Error(
      `Missing reconciliation for ${params.runId} affected ${checkpoint.rowsAffected} checkpoints.`,
    );
  }
  if (checkpoint.rowsAffected === 0) {
    return reconcileBatch(params);
  }
  if (finishing) {
    return {
      status: "complete",
      result: await buildResult(params.runId, params.database),
    };
  }
  return { status: "paused", phase: "missing", cursor: nextCursor };
}

async function reconcileBatch(
  params: ReconciliationContext,
): Promise<DurableReconciliationBatchResult> {
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
  if (
    stage === "project_changes" ||
    stage === "full_reindex_prepare" ||
    stage === "full_reindex_load" ||
    stage === "full_reindex_publish" ||
    stage === "full_reindex_move_pending" ||
    stage === "full_reindex_publish_failed" ||
    stage === "match_alerts" ||
    stage === "released"
  ) {
    return {
      status: "complete",
      result: await buildResult(params.runId, params.database),
    };
  }
  if (stage === "sources") {
    throw new Error(
      `Ingestion run ${params.runId} has not validated its sources.`,
    );
  }
  if (stage === "reconcile_upsert") {
    return runUpsertBatch({
      ...params,
      cursor: run.reconciliationCursor,
      runTimestamp: run.startedAt,
    });
  }
  return runMissingBatch({
    ...params,
    cursor: run.reconciliationCursor,
    runTimestamp: run.startedAt,
    acceptedSources: parseAcceptedSources(run.acceptedSources),
  });
}

/**
 * Advances reconciliation through as many guarded batches as fit in one
 * workflow step, loading the run's staged inventory once.
 */
export async function reconcileDurableIngestionRun(params: {
  runId: string;
  database: LibSQLDatabase;
  batchClient: BatchClient;
  snapshotStore: IngestionSnapshotStore;
  budgetMs?: number;
}): Promise<DurableReconciliationBatchResult> {
  let inventory: Promise<RunSnapshotInventory> | null = null;
  const context: ReconciliationContext = {
    runId: params.runId,
    database: params.database,
    batchClient: params.batchClient,
    inventory: () =>
      (inventory ??= loadRunSnapshotInventory({
        runId: params.runId,
        database: params.database,
        store: params.snapshotStore,
      })),
  };
  const deadline =
    Date.now() + (params.budgetMs ?? RECONCILIATION_STEP_BUDGET_MS);
  while (true) {
    const result = await reconcileBatch(context);
    if (result.status !== "paused" || Date.now() >= deadline) return result;
  }
}
