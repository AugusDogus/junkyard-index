import { rememberModelRedirects } from "./vin-canonicalization";
import type { Client, InStatement, InValue } from "@libsql/client";
import { and, asc, eq, gt, gte, inArray, sql } from "drizzle-orm";
import { Duration } from "effect";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import type { FirstSighting } from "~/lib/first-sighting";
import {
  mapIngestionSources,
  RETIRED_INGESTION_SOURCES,
} from "~/lib/ingestion-source";
import {
  ingestionRun,
  ingestionSourceRun,
  vehicle,
  vehicleDeparture,
  yardArrivalBaseline,
  yardInventory,
} from "~/schema";
import { parseIngestionErrors } from "./durable-ingestion-repository";
import type {
  DurableIngestionResult,
  DurableReconciliationBatchResult,
} from "./durable-ingestion-types";
import type { SearchPublicationMode } from "./search-publication-flag";
import { SearchOutbox } from "./search-outbox";
import {
  parseAcceptedSources,
  parseDurableRunStage,
} from "./durable-run-state";
import { DURABLE_INGESTION_SOURCES } from "./durable-source";
import type { IngestionSnapshotStore } from "./ingestion-snapshot-store";
import { PROVIDER_CHUNK_WALL_LIMIT } from "./provider-chunk-clock";
import {
  type MissingVehicleTransition,
  planChangedVehicleUpserts,
  planMissingVehicleTransitions,
  RELIST_WINDOW_MS,
} from "./reconciliation-policy";
import {
  forgetRunSnapshotInventory,
  loadRunSnapshotInventory,
  type RunSnapshotInventory,
} from "./run-snapshot-inventory";
import { normalizeCanonicalVehicle } from "./normalization";
import type { CanonicalVehicle } from "./types";
import {
  yardInventoryRefreshStatements,
  yardPublicationStatement,
} from "./yard-inventory";

const RECONCILIATION_BATCH_SIZE = 500;
const MISSING_DELETE_AFTER_MS = 3 * 24 * 60 * 60 * 1000;
const VEHICLE_VALUE_COLUMN_COUNT = 33;

// Leave most of a workflow step's duration for the batches' own writes.
const RECONCILIATION_STEP_BUDGET_MS = 240_000;
/**
 * No step starts another batch after this much wall time, however long its
 * inventory load took. A step can start inline late in its function, so it
 * gets the same wall allowance as a provider chunk step.
 */
const RECONCILIATION_STEP_WALL_LIMIT_MS = Duration.toMillis(
  PROVIDER_CHUNK_WALL_LIMIT,
);

type BatchClient = Pick<Client, "batch">;

interface ReconciliationContext {
  runId: string;
  database: LibSQLDatabase;
  batchClient: BatchClient;
  /** Loads the run's staged inventory at most once per process while the
   * run keeps pausing. */
  inventory: () => Promise<RunSnapshotInventory>;
  /** Whether the final batch hands the run to search or releases it. */
  searchPublication: SearchPublicationMode;
  canonicalize?: (rows: CanonicalVehicle[]) => Promise<CanonicalVehicle[]>;
}

/**
 * Sources whose existing rows this run reconciles: its accepted sources, plus
 * retired sources, which never run again and so reconcile as if every run
 * accepted an empty snapshot of them. Their rows go missing then deleted, and
 * a source that still lists one of their VINs takes it over.
 */
function reconciledSources(
  acceptedSources: Iterable<string>,
): ReadonlySet<string> {
  return new Set([...acceptedSources, ...RETIRED_INGESTION_SOURCES]);
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

/** A vehicle row as the missing batch read it: its VIN and owning source. */
type ReadVehicle = { vin: string; source: string };

/**
 * Restricts a missing-phase write to rows still owned by the source the batch
 * read, so a run only ages, restores or deletes its reconciled sources' rows.
 */
function readVehicleFilter(rows: readonly ReadVehicle[]): {
  sql: string;
  args: InValue[];
} {
  return {
    sql: `(vin, source) in (values ${rows.map(() => "(?, ?)").join(", ")})`,
    args: rows.flatMap((row) => [row.vin, row.source]),
  };
}

type VehicleChangeType = "upsert" | "missing" | "delete";

/**
 * Upsert changes describe the run's own listings. Missing-phase changes
 * describe rows the batch read, and are queued only while that source still
 * owns the row, matching the scoped writes they accompany.
 */
type VehicleChanges =
  | {
      stage: "reconcile_upsert";
      changes: Array<{ vin: string; changeType: "upsert" }>;
    }
  | {
      stage: "reconcile_missing";
      changes: Array<ReadVehicle & { changeType: VehicleChangeType }>;
    };

function changeInsertStatement(
  params: VehicleChanges & {
    runId: string;
    cursor: string | null;
    now: number;
  },
): InStatement | null {
  if (params.changes.length === 0) return null;
  const scoped = params.stage === "reconcile_missing";
  return {
    sql: `
      insert into vehicle_change_v2 (
        run_id, vin, change_type, payload, payload_version, created_at
      )
      select ?, column1, column2, null, 1, ?
      from (values ${params.changes.map(() => (scoped ? "(?, ?, ?)" : "(?, ?)")).join(", ")})
      where ${guardSql(params.stage)}
        ${scoped ? "and exists (select 1 from vehicle where vehicle.vin = column1 and vehicle.source = column3)" : ""}
      on conflict(run_id, vin, change_type)
        where processed_at is null
        do nothing
    `,
    args: [
      params.runId,
      params.now,
      ...(params.stage === "reconcile_missing"
        ? params.changes.flatMap(({ vin, changeType, source }) => [
            vin,
            changeType,
            source,
          ])
        : params.changes.flatMap(({ vin, changeType }) => [vin, changeType])),
      params.runId,
      params.cursor,
    ],
  };
}

function toVehicleValues(params: {
  vehicle: CanonicalVehicle;
  firstSeenAt: Date;
  firstSighting: FirstSighting;
  observedArrivalAt: Date | null;
  runTimestamp: Date;
}): InValue[] {
  const value = params.vehicle;
  return [
    value.vin,
    value.source,
    value.year,
    value.make,
    value.model,
    value.sourceMake ?? null,
    value.sourceModel ?? null,
    value.color,
    value.stockNumber,
    value.imageUrl,
    value.availableDate,
    params.observedArrivalAt?.getTime() ?? null,
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
    params.firstSighting,
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
    firstSighting: FirstSighting;
    observedArrivalAt: Date | null;
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
        vin, source, year, make, model, source_make, source_model, color, stock_number, image_url,
        available_date, observed_arrival_at, location_code, location_name, location_city, state,
        state_abbr, lat, lng, section, row, space, details_url, parts_url,
        prices_url, engine, trim, transmission, first_seen_at, first_sighting,
        last_seen_at, missing_since_at, missing_run_count
      )
      select ${columns}
      from (values ${placeholders})
      where ${guardSql("reconcile_upsert")}
      on conflict(vin) do update set
        source = excluded.source,
        year = excluded.year,
        make = excluded.make,
        model = excluded.model,
        source_make = excluded.source_make,
        source_model = excluded.source_model,
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

const PUBLICATION_SET_SQL = `
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
`;

const PUBLICATION_GUARD_SQL = `
  where id = ?
    and status = 'running'
    and active_slot = 1
    and stage = 'reconcile_missing'
    and reconciliation_cursor is ?
`;

/**
 * The final batch's checkpoint, which publishes the run's inventory. Inline,
 * the run keeps the commit for search: it projects its changes, or rebuilds
 * when it carries `full_reindex_required` or a finished run left changes the
 * search projector never made searchable (decoupled publication was switched
 * back off). Skipped, the run releases here without touching search. It
 * keeps its unprocessed change rows and records `full_reindex_required`,
 * which the next run to claim the commit inherits, so the first inline run
 * after the switch turns off rebuilds the index from Turso and covers every
 * skipped change. Decoupled, the run also releases here and keeps its change
 * rows, which the search projector reads as its outbox; it owes search no
 * rebuild, so it clears any it inherited. Released runs record their
 * published totals here because no later stage does.
 *
 * Inline args: upserted, deleted, runId, now, now, runId, cursor.
 * Skipped args: runId, now, now, then the inline args.
 * Decoupled args: now, now, then the inline args.
 */
function publicationStatementSql(mode: SearchPublicationMode): string {
  switch (mode) {
    case "inline":
      return `
        update ingestion_run
        set stage = case
              when full_reindex_required = 1
                or ${SearchOutbox.finishedRunOwesSearchSql}
                then 'full_reindex_prepare'
              else 'project_changes'
            end,
            full_reindex_required = case
              when ${SearchOutbox.finishedRunOwesSearchSql} then 1
              else full_reindex_required
            end,
            ${PUBLICATION_SET_SQL}
        ${PUBLICATION_GUARD_SQL}
      `;
    case "skipped":
      return `
        update ingestion_run
        set status = 'success',
            stage = 'released',
            active_slot = null,
            full_reindex_required = case
              when full_reindex_required = 1 or exists (
                select 1 from vehicle_change_v2
                where run_id = ? and processed_at is null
              ) then 1
              else 0
            end,
            published_vehicle_count = (select count(*) from vehicle),
            published_yard_count = (
              select count(distinct location_code) from vehicle
            ),
            released_at = ?,
            completed_at = ?,
            ${PUBLICATION_SET_SQL}
        ${PUBLICATION_GUARD_SQL}
      `;
    case "decoupled":
      // The batch refreshed the yard summaries first, so they hold the live
      // totals without reading every vehicle.
      return `
        update ingestion_run
        set status = 'success',
            stage = 'released',
            active_slot = null,
            full_reindex_required = 0,
            published_vehicle_count = (
              select coalesce(sum(vehicle_count), 0) from yard_inventory
            ),
            published_yard_count = (select count(*) from yard_inventory),
            released_at = ?,
            completed_at = ?,
            ${PUBLICATION_SET_SQL}
        ${PUBLICATION_GUARD_SQL}
      `;
  }
}

/** Placeholder args a final batch's publication checkpoint adds before the inline ones. */
function publicationLeadingArgs(
  mode: SearchPublicationMode,
  runId: string,
  now: number,
): InValue[] {
  switch (mode) {
    case "inline":
      return [];
    case "skipped":
      return [runId, now, now];
    case "decoupled":
      return [now, now];
  }
}

/**
 * A run whose final batch released it without search publication: skipped,
 * or decoupled (the search projector publishes its changes).
 */
function releasedWithoutSearch(run: typeof ingestionRun.$inferSelect) {
  return (
    run.status === "success" &&
    run.stage === "released" &&
    run.inventoryPublishedAt !== null &&
    run.searchPublishedAt === null
  );
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
    // The yard summaries the publication batch refreshed hold the live
    // counts, so this reads a few hundred rows, not every vehicle.
    const [inventory] = await database
      .select({
        vehicleCount: sql<number>`coalesce(sum(${yardInventory.vehicleCount}), 0)`,
        yardCount: sql<number>`count(*)`,
      })
      .from(yardInventory);
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
  const sourceRows = inventory.vins
    .slice(start, start + RECONCILIATION_BATCH_SIZE)
    .flatMap((vin) => {
      const snapshot = inventory.vehicles.get(vin);
      return snapshot ? [snapshot] : [];
    });

  const rows = params.canonicalize
    ? await params.canonicalize(sourceRows)
    : sourceRows.map(normalizeCanonicalVehicle);
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
  const reconciled = reconciledSources(inventory.acceptedSources);
  const baselines = await params.database
    .select()
    .from(yardArrivalBaseline)
    .where(inArray(yardArrivalBaseline.source, [...inventory.acceptedSources]));
  const publishedYards = new Map<string, Set<string>>();
  for (const yard of baselines) {
    const locations = publishedYards.get(yard.source) ?? new Set<string>();
    locations.add(yard.locationCode);
    publishedYards.set(yard.source, locations);
  }
  // Only VINs without a row can be relists of a deleted listing.
  const existingVins = new Set(existingRows.map((row) => row.vin));
  const unlistedVins = vins.filter((vin) => !existingVins.has(vin));
  const recentDepartures =
    unlistedVins.length === 0
      ? []
      : await params.database
          .select({
            vin: vehicleDeparture.vin,
            source: vehicleDeparture.source,
            locationCode: vehicleDeparture.locationCode,
            firstSeenAt: vehicleDeparture.firstSeenAt,
            firstSighting: vehicleDeparture.firstSighting,
            departedAt: vehicleDeparture.departedAt,
          })
          .from(vehicleDeparture)
          .where(
            and(
              inArray(vehicleDeparture.vin, unlistedVins),
              gte(
                vehicleDeparture.departedAt,
                new Date(params.runTimestamp.getTime() - RELIST_WINDOW_MS),
              ),
            ),
          );
  const changed = planChangedVehicleUpserts({
    inventory: finalInventory,
    existingRows,
    recentDepartures,
    runTimestamp: params.runTimestamp,
    acceptedSources: reconciled,
    publishedYards,
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
  const wasMissing = new Set(
    existingRows
      .filter((row) => row.missingSinceAt !== null)
      .map((row) => row.vin),
  );
  const withdrawals = departureWithdrawalStatement({
    runId: params.runId,
    stage: "reconcile_upsert",
    cursor: params.cursor,
    vins: changed
      .map(({ vehicle: next }) => next.vin)
      .filter((vin) => !existingVins.has(vin) || wasMissing.has(vin)),
  });
  if (withdrawals) statements.push(withdrawals);
  // A VIN taken over by a higher-priority source leaves its previous source's
  // yard. That source is not reconciled in this run, so refresh it here.
  const existingSource = new Map(
    existingRows.map((row) => [row.vin, row.source] as const),
  );
  const displacedSources = changed.flatMap(({ vehicle: next }) => {
    const previous = existingSource.get(next.vin);
    return previous !== undefined &&
      previous !== next.source &&
      !reconciled.has(previous)
      ? [previous]
      : [];
  });
  statements.push(...yardInventoryRefreshStatements(displacedSources, now));
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
  await rememberModelRedirects(
    params.database,
    changed.map((entry) => entry.vehicle),
  );
  return {
    status: "paused",
    phase: nextStage === "reconcile_missing" ? "missing" : "upsert",
    cursor: nextStage === "reconcile_missing" ? null : nextCursor,
  };
}

type ScopedTransition = MissingVehicleTransition & { source: string };

/**
 * Withdraws the departures of listings that are back: the VIN's row has the
 * departed listing's first sighting and is no longer missing. A relist keeps
 * that first sighting; a VIN listed anew gets a new one, so its departure
 * stands. Runs after the batch's upsert or restore.
 */
function departureWithdrawalStatement(params: {
  runId: string;
  stage: "reconcile_upsert" | "reconcile_missing";
  cursor: string | null;
  vins: readonly string[];
}): InStatement | null {
  if (params.vins.length === 0) return null;
  return {
    sql: `
      delete from vehicle_departure
      where vin in (${params.vins.map(() => "?").join(", ")})
        and exists (
          select 1 from vehicle
          where vehicle.vin = vehicle_departure.vin
            and vehicle.first_seen_at = vehicle_departure.first_seen_at
            and vehicle.missing_since_at is null
        )
        and ${guardSql(params.stage)}
    `,
    args: [...params.vins, params.runId, params.cursor],
  };
}

/**
 * Records a departure for each vehicle the batch deletes, from the row being
 * deleted. A departure the hourly capture already recorded is kept.
 */
function departureInsertStatement(params: {
  runId: string;
  cursor: string | null;
  transitions: ScopedTransition[];
  now: number;
}): InStatement | null {
  const deleted = params.transitions.filter(
    (transition) => transition.changeType === "delete",
  );
  if (deleted.length === 0) return null;
  const filter = readVehicleFilter(deleted);
  return {
    sql: `
      insert into vehicle_departure (
        vin, source, location_code, year, make, model, available_date,
        first_seen_at, first_sighting, departed_at, recorded_at
      )
      select vin, source, location_code, year, make, model, available_date,
        first_seen_at, first_sighting, case vin ${deleted.map(() => "when ? then ?").join(" ")} end, ?
      from vehicle
      where ${filter.sql}
        and ${guardSql("reconcile_missing")}
      on conflict do nothing
    `,
    args: [
      ...deleted.flatMap((transition) => [
        transition.vin,
        transition.missingSinceAt,
      ]),
      params.now,
      ...filter.args,
      params.runId,
      params.cursor,
    ],
  };
}

function missingUpdateStatement(params: {
  runId: string;
  cursor: string | null;
  transitions: ScopedTransition[];
}): InStatement | null {
  const missing = params.transitions.filter(
    (transition) => transition.changeType === "missing",
  );
  if (missing.length === 0) return null;
  const filter = readVehicleFilter(missing);
  return {
    sql: `
      update vehicle
      set missing_since_at = case vin ${missing.map(() => "when ? then ?").join(" ")} else missing_since_at end,
          missing_run_count = case vin ${missing.map(() => "when ? then ?").join(" ")} else missing_run_count end
      where ${filter.sql}
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
      ...filter.args,
      params.runId,
      params.cursor,
    ],
  };
}

function deleteStatement(params: {
  runId: string;
  cursor: string | null;
  transitions: ScopedTransition[];
}): InStatement | null {
  const deleted = params.transitions.filter(
    (transition) => transition.changeType === "delete",
  );
  if (deleted.length === 0) return null;
  const filter = readVehicleFilter(deleted);
  return {
    sql: `
      delete from vehicle
      where ${filter.sql}
        and ${guardSql("reconcile_missing")}
    `,
    args: [...filter.args, params.runId, params.cursor],
  };
}

async function runMissingBatch(
  params: ReconciliationContext & {
    cursor: string | null;
    runTimestamp: Date;
    acceptedSources: string[];
  },
): Promise<DurableReconciliationBatchResult> {
  const reconciled = reconciledSources(params.acceptedSources);
  const sourceRows = await params.database
    .select({
      vin: vehicle.vin,
      source: vehicle.source,
      locationCode: vehicle.locationCode,
      missingSinceAt: vehicle.missingSinceAt,
      missingRunCount: vehicle.missingRunCount,
    })
    .from(vehicle)
    .where(
      and(
        inArray(vehicle.source, [...reconciled]),
        params.cursor === null ? undefined : gt(vehicle.vin, params.cursor),
      ),
    )
    .orderBy(asc(vehicle.vin))
    .limit(RECONCILIATION_BATCH_SIZE);
  const inventory = await params.inventory();
  // An accepted source can observe a VIN whose canonical owner is outside
  // this run. Preserve that restoration with bounded primary-key lookups.
  const observationStart = firstVinAfter(
    inventory.observedVinOrder,
    params.cursor,
  );
  const observations = inventory.observedVinOrder.slice(
    observationStart,
    observationStart + RECONCILIATION_BATCH_SIZE,
  );
  const candidates = [
    ...new Set([...sourceRows.map((row) => row.vin), ...observations]),
  ]
    .sort()
    .slice(0, RECONCILIATION_BATCH_SIZE);
  const sourceVins = new Set(sourceRows.map((row) => row.vin));
  const lookupVins = candidates.filter((vin) => !sourceVins.has(vin));
  const observedRows =
    lookupVins.length === 0
      ? []
      : await params.database
          .select({
            vin: vehicle.vin,
            source: vehicle.source,
            locationCode: vehicle.locationCode,
            missingSinceAt: vehicle.missingSinceAt,
            missingRunCount: vehicle.missingRunCount,
          })
          .from(vehicle)
          .where(inArray(vehicle.vin, lookupVins));
  const candidateSet = new Set(candidates);
  const rows = [
    ...sourceRows.filter((row) => candidateSet.has(row.vin)),
    ...observedRows,
  ];
  const presentVins = new Set(
    rows
      .map((row) => row.vin)
      .filter(
        (vin) => inventory.vehicles.has(vin) || inventory.observedVins.has(vin),
      ),
  );
  const restoreRows = rows.filter((row) => inventory.observedVins.has(row.vin));
  const observedSet = new Set(restoreRows.map((row) => row.vin));
  const restoredRows = rows.filter(
    (row) =>
      observedSet.has(row.vin) &&
      (row.missingSinceAt !== null || (row.missingRunCount ?? 0) !== 0),
  );
  const readSource = new Map(rows.map((row) => [row.vin, row.source] as const));
  const transitions = planMissingVehicleTransitions({
    presentVins,
    existingRows: rows.filter(
      (row) =>
        (row.source !== "urgiis" ||
          !inventory.preservedUrgiisYards.has(row.locationCode)) &&
        (row.source !== "autorecycler" ||
          !inventory.preservedAutorecyclerYards.has(row.locationCode)),
    ),
    runTimestamp: params.runTimestamp,
    acceptedSources: reconciled,
    deleteAfterMs: MISSING_DELETE_AFTER_MS,
  }).map((transition): ScopedTransition => {
    const source = readSource.get(transition.vin);
    if (source === undefined) {
      throw new Error(
        `Missing reconciliation for ${params.runId} planned a ${transition.changeType} for VIN ${transition.vin}, which its batch did not read. Nothing was written; retrying the step re-reads the batch.`,
      );
    }
    return { ...transition, source };
  });

  const finishing = candidates.length < RECONCILIATION_BATCH_SIZE;
  const nextCursor = candidates.at(-1) ?? params.cursor;
  const now = Date.now();
  const statements: InStatement[] = [];
  const changes = changeInsertStatement({
    runId: params.runId,
    stage: "reconcile_missing",
    cursor: params.cursor,
    changes: [
      ...transitions.map(({ vin, changeType, source }) => ({
        vin,
        changeType,
        source,
      })),
      ...restoredRows.map(({ vin, source }) => ({
        vin,
        source,
        changeType: "upsert" as const,
      })),
    ],
    now,
  });
  if (changes) statements.push(changes);
  if (restoreRows.length > 0) {
    const filter = readVehicleFilter(restoreRows);
    statements.push({
      sql: `
        update vehicle
        set missing_since_at = null, missing_run_count = 0, last_seen_at = ?
        where ${filter.sql}
          and ${guardSql("reconcile_missing")}
      `,
      args: [
        params.runTimestamp.getTime(),
        ...filter.args,
        params.runId,
        params.cursor,
      ],
    });
  }
  // An observation can restore a VIN another source owns. That source is not
  // reconciled in this run, so refresh its yard summary here, which the
  // published counts are read from.
  const restoredOwners = restoredRows
    .filter((row) => !reconciled.has(row.source))
    .map((row) => row.source);
  statements.push(...yardInventoryRefreshStatements(restoredOwners, now));
  const withdrawals = departureWithdrawalStatement({
    runId: params.runId,
    stage: "reconcile_missing",
    cursor: params.cursor,
    vins: restoredRows.map((row) => row.vin),
  });
  if (withdrawals) statements.push(withdrawals);
  const missingUpdate = missingUpdateStatement({
    runId: params.runId,
    cursor: params.cursor,
    transitions,
  });
  if (missingUpdate) statements.push(missingUpdate);
  const departures = departureInsertStatement({
    runId: params.runId,
    cursor: params.cursor,
    transitions,
    now,
  });
  if (departures) statements.push(departures);
  const deletes = deleteStatement({
    runId: params.runId,
    cursor: params.cursor,
    transitions,
  });
  if (deletes) statements.push(deletes);
  // The last batch commits the reconciled sources' yard summary with them.
  if (finishing)
    statements.push(...yardInventoryRefreshStatements([...reconciled], now));
  if (finishing) {
    const publication = yardPublicationStatement(
      params.acceptedSources,
      new Map([
        ["autorecycler", inventory.preservedAutorecyclerYards],
        ["urgiis", inventory.preservedUrgiisYards],
      ]),
      params.runTimestamp.getTime(),
    );
    if (publication) statements.push(publication);
  }
  // Only the publication batch establishes a baseline. Earlier upsert batches
  // (including resumed ones) must not make their own backfill look new.
  if (finishing && params.acceptedSources.length > 0) {
    statements.push({
      sql: `insert into yard_arrival_baseline (source, location_code, established_at)
        select distinct source, location_code, ? from vehicle
        where source in (${params.acceptedSources.map(() => "?").join(", ")})
          and ${guardSql("reconcile_missing")}
        on conflict(source, location_code) do nothing`,
      args: [
        params.runTimestamp.getTime(),
        ...params.acceptedSources,
        params.runId,
        params.cursor,
      ],
    });
  }
  const checkpointIndex = statements.length;
  const deletedCount = transitions.filter(
    (transition) => transition.changeType === "delete",
  ).length;
  statements.push({
    sql: finishing
      ? publicationStatementSql(params.searchPublication)
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
          ...publicationLeadingArgs(
            params.searchPublication,
            params.runId,
            now,
          ),
          restoredRows.length,
          deletedCount,
          params.runId,
          now,
          now,
          params.runId,
          params.cursor,
        ]
      : [
          nextCursor,
          restoredRows.length,
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
      search: params.searchPublication === "inline" ? "pending" : "skipped",
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
  // A retried step finds the run its final batch already released.
  if (releasedWithoutSearch(run)) {
    return {
      status: "complete",
      result: await buildResult(params.runId, params.database),
      search: "skipped",
    };
  }
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
      search: "pending",
    };
  }
  if (stage === "sources") {
    throw new Error(
      `Ingestion run ${params.runId} has not validated its sources.`,
    );
  }
  // Stamp vehicles with the commit claim so they follow every earlier alert
  // check, which bounds its window before any commit still in progress.
  // Local runs that never claim use their start.
  const runTimestamp = run.commitStartedAt ?? run.startedAt;
  if (stage === "reconcile_upsert") {
    return runUpsertBatch({
      ...params,
      cursor: run.reconciliationCursor,
      runTimestamp,
    });
  }
  return runMissingBatch({
    ...params,
    cursor: run.reconciliationCursor,
    runTimestamp,
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
  /** Defaults to inline search publication. */
  searchPublication?: SearchPublicationMode;
  canonicalize?: (rows: CanonicalVehicle[]) => Promise<CanonicalVehicle[]>;
}): Promise<DurableReconciliationBatchResult> {
  let inventory: Promise<RunSnapshotInventory> | null = null;
  // Loading the staged inventory can take longer than the batch budget. It
  // is charged to the step once, not to its batches, or a slow load leaves
  // every step a single batch and pays the load again for each one.
  let loadMs = 0;
  const load = async () => {
    const loadStarted = Date.now();
    try {
      return await loadRunSnapshotInventory({
        runId: params.runId,
        database: params.database,
        store: params.snapshotStore,
      });
    } finally {
      loadMs = Date.now() - loadStarted;
    }
  };
  const context: ReconciliationContext = {
    runId: params.runId,
    database: params.database,
    batchClient: params.batchClient,
    searchPublication: params.searchPublication ?? "inline",
    canonicalize: params.canonicalize,
    inventory: () => (inventory ??= load()),
  };
  const started = Date.now();
  const budgetMs = params.budgetMs ?? RECONCILIATION_STEP_BUDGET_MS;
  while (true) {
    const result = await reconcileBatch(context);
    if (result.status !== "paused") {
      forgetRunSnapshotInventory(params.snapshotStore, params.runId);
      return result;
    }
    const elapsed = Date.now() - started;
    if (
      elapsed - loadMs >= budgetMs ||
      elapsed >= RECONCILIATION_STEP_WALL_LIMIT_MS
    )
      return result;
  }
}
