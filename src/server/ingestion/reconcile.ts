import { eq, inArray, sql } from "drizzle-orm";
import { db } from "~/lib/db";
import { vehicle, vehicleChange } from "~/schema";
import type { CanonicalVehicle } from "./types";

type SourceName = CanonicalVehicle["source"];
type ExistingVehicleRow = typeof vehicle.$inferSelect;
type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

const VEHICLE_UPSERT_CHUNK_SIZE = 500;
const VEHICLE_CHANGE_CHUNK_SIZE = 1_000;
const VIN_DELETE_CHUNK_SIZE = 500;

interface ReconcileOptions {
  runId: string;
  runTimestamp: Date;
  finalInventoryByVin: ReadonlyMap<string, CanonicalVehicle>;
  allowAdvanceMissingState: boolean;
  missingDeleteAfterRuns: number;
  missingDeleteAfterMs: number;
}

export interface ReconcileResult {
  upsertedCount: number;
  deletedCount: number;
  missingUpdatedCount: number;
  skippedMissingAdvance: boolean;
  timingsMs: {
    readExistingMs: number;
    planMs: number;
    upsertWriteMs: number;
    missingWriteMs: number;
  };
}

interface PlannedVehicleUpsert {
  vehicle: CanonicalVehicle;
  firstSeenAt: Date;
}

interface MissingTransition {
  vin: string;
  changeType: "missing" | "delete";
  missingSinceAt: Date;
  missingRunCount: number;
}

interface ReconcilePlan {
  upsertedCount: number;
  changedUpserts: PlannedVehicleUpsert[];
  missingTransitions: MissingTransition[];
  deleteVins: string[];
  skippedMissingAdvance: boolean;
}

export function buildFinalInventoryByVin(params: {
  healthySources: SourceName[];
  row52ByVin: ReadonlyMap<string, CanonicalVehicle>;
  pypByVin: ReadonlyMap<string, CanonicalVehicle>;
}): Map<string, CanonicalVehicle> {
  const finalInventory = new Map<string, CanonicalVehicle>();

  if (params.healthySources.includes("pyp")) {
    for (const [vin, vehicle] of params.pypByVin) {
      finalInventory.set(vin, vehicle);
    }
  }

  if (params.healthySources.includes("row52")) {
    for (const [vin, vehicle] of params.row52ByVin) {
      finalInventory.set(vin, vehicle);
    }
  }

  return finalInventory;
}

function vehicleNeedsUpsert(
  existingVehicle: ExistingVehicleRow | undefined,
  nextVehicle: CanonicalVehicle,
): boolean {
  if (!existingVehicle) {
    return true;
  }

  return (
    existingVehicle.source !== nextVehicle.source ||
    existingVehicle.year !== nextVehicle.year ||
    existingVehicle.make !== nextVehicle.make ||
    existingVehicle.model !== nextVehicle.model ||
    existingVehicle.color !== nextVehicle.color ||
    existingVehicle.stockNumber !== nextVehicle.stockNumber ||
    existingVehicle.imageUrl !== nextVehicle.imageUrl ||
    existingVehicle.availableDate !== nextVehicle.availableDate ||
    existingVehicle.locationCode !== nextVehicle.locationCode ||
    existingVehicle.locationName !== nextVehicle.locationName ||
    existingVehicle.state !== nextVehicle.state ||
    existingVehicle.stateAbbr !== nextVehicle.stateAbbr ||
    existingVehicle.lat !== nextVehicle.lat ||
    existingVehicle.lng !== nextVehicle.lng ||
    existingVehicle.section !== nextVehicle.section ||
    existingVehicle.row !== nextVehicle.row ||
    existingVehicle.space !== nextVehicle.space ||
    existingVehicle.detailsUrl !== nextVehicle.detailsUrl ||
    existingVehicle.partsUrl !== nextVehicle.partsUrl ||
    existingVehicle.pricesUrl !== nextVehicle.pricesUrl ||
    existingVehicle.engine !== nextVehicle.engine ||
    existingVehicle.trim !== nextVehicle.trim ||
    existingVehicle.transmission !== nextVehicle.transmission ||
    existingVehicle.missingSinceAt !== null ||
    (existingVehicle.missingRunCount ?? 0) !== 0
  );
}

export function createReconcilePlan(params: {
  finalInventoryByVin: ReadonlyMap<string, CanonicalVehicle>;
  existingVehicles: ExistingVehicleRow[];
  runTimestamp: Date;
  allowAdvanceMissingState: boolean;
  missingDeleteAfterRuns: number;
  missingDeleteAfterMs: number;
}): ReconcilePlan {
  const existingByVin = new Map<string, ExistingVehicleRow>();
  for (const existingVehicle of params.existingVehicles) {
    existingByVin.set(existingVehicle.vin, existingVehicle);
  }

  const changedUpserts: PlannedVehicleUpsert[] = [];
  for (const [vin, nextVehicle] of params.finalInventoryByVin) {
    const existingVehicle = existingByVin.get(vin);
    if (!vehicleNeedsUpsert(existingVehicle, nextVehicle)) {
      continue;
    }

    changedUpserts.push({
      vehicle: nextVehicle,
      firstSeenAt: existingVehicle?.firstSeenAt ?? params.runTimestamp,
    });
  }

  if (!params.allowAdvanceMissingState) {
    return {
      upsertedCount: params.finalInventoryByVin.size,
      changedUpserts,
      missingTransitions: [],
      deleteVins: [],
      skippedMissingAdvance: true,
    };
  }

  const missingSinceCutoffMs =
    params.runTimestamp.getTime() - params.missingDeleteAfterMs;
  const missingTransitions: MissingTransition[] = [];
  const deleteVins: string[] = [];

  for (const existingVehicle of params.existingVehicles) {
    if (params.finalInventoryByVin.has(existingVehicle.vin)) {
      continue;
    }

    const missingSinceAt = existingVehicle.missingSinceAt ?? params.runTimestamp;
    const missingRunCount = (existingVehicle.missingRunCount ?? 0) + 1;
    const shouldDelete =
      missingRunCount >= params.missingDeleteAfterRuns ||
      missingSinceAt.getTime() <= missingSinceCutoffMs;

    if (shouldDelete) {
      deleteVins.push(existingVehicle.vin);
    }

    missingTransitions.push({
      vin: existingVehicle.vin,
      changeType: shouldDelete ? "delete" : "missing",
      missingSinceAt,
      missingRunCount,
    });
  }

  return {
    upsertedCount: params.finalInventoryByVin.size,
    changedUpserts,
    missingTransitions,
    deleteVins,
    skippedMissingAdvance: false,
  };
}

function chunkValues<T>(values: T[], chunkSize: number): T[][] {
  const chunks: T[][] = [];

  for (let index = 0; index < values.length; index += chunkSize) {
    chunks.push(values.slice(index, index + chunkSize));
  }

  return chunks;
}

function toVehicleRow(params: {
  vehicle: CanonicalVehicle;
  firstSeenAt: Date;
  runTimestamp: Date;
}): typeof vehicle.$inferInsert {
  return {
    vin: params.vehicle.vin,
    source: params.vehicle.source,
    year: params.vehicle.year,
    make: params.vehicle.make,
    model: params.vehicle.model,
    color: params.vehicle.color,
    stockNumber: params.vehicle.stockNumber,
    imageUrl: params.vehicle.imageUrl,
    availableDate: params.vehicle.availableDate,
    locationCode: params.vehicle.locationCode,
    locationName: params.vehicle.locationName,
    state: params.vehicle.state,
    stateAbbr: params.vehicle.stateAbbr,
    lat: params.vehicle.lat,
    lng: params.vehicle.lng,
    section: params.vehicle.section,
    row: params.vehicle.row,
    space: params.vehicle.space,
    detailsUrl: params.vehicle.detailsUrl,
    partsUrl: params.vehicle.partsUrl,
    pricesUrl: params.vehicle.pricesUrl,
    engine: params.vehicle.engine,
    trim: params.vehicle.trim,
    transmission: params.vehicle.transmission,
    firstSeenAt: params.firstSeenAt,
    lastSeenAt: params.runTimestamp,
    missingSinceAt: null,
    missingRunCount: 0,
  };
}

async function insertVehicleChanges(
  tx: DbTransaction,
  rows: Array<typeof vehicleChange.$inferInsert>,
): Promise<void> {
  for (const chunk of chunkValues(rows, VEHICLE_CHANGE_CHUNK_SIZE)) {
    await tx.insert(vehicleChange).values(chunk);
  }
}

async function upsertVehicles(
  tx: DbTransaction,
  rows: Array<typeof vehicle.$inferInsert>,
): Promise<void> {
  for (const chunk of chunkValues(rows, VEHICLE_UPSERT_CHUNK_SIZE)) {
    await tx
      .insert(vehicle)
      .values(chunk)
      .onConflictDoUpdate({
        target: vehicle.vin,
        set: {
          source: sql`excluded.source`,
          year: sql`excluded.year`,
          make: sql`excluded.make`,
          model: sql`excluded.model`,
          color: sql`excluded.color`,
          stockNumber: sql`excluded.stock_number`,
          imageUrl: sql`excluded.image_url`,
          availableDate: sql`excluded.available_date`,
          locationCode: sql`excluded.location_code`,
          locationName: sql`excluded.location_name`,
          state: sql`excluded.state`,
          stateAbbr: sql`excluded.state_abbr`,
          lat: sql`excluded.lat`,
          lng: sql`excluded.lng`,
          section: sql`excluded.section`,
          row: sql`excluded.row`,
          space: sql`excluded.space`,
          detailsUrl: sql`excluded.details_url`,
          partsUrl: sql`excluded.parts_url`,
          pricesUrl: sql`excluded.prices_url`,
          engine: sql`excluded.engine`,
          trim: sql`excluded.trim`,
          transmission: sql`excluded.transmission`,
          lastSeenAt: sql`excluded.last_seen_at`,
          missingSinceAt: null,
          missingRunCount: 0,
        },
      });
  }
}

async function updateMissingVehicles(
  tx: DbTransaction,
  missingTransitions: MissingTransition[],
): Promise<void> {
  for (const transition of missingTransitions) {
    await tx
      .update(vehicle)
      .set({
        missingSinceAt: transition.missingSinceAt,
        missingRunCount: transition.missingRunCount,
      })
      .where(eq(vehicle.vin, transition.vin));
  }
}

async function deleteVehiclesByVin(
  tx: DbTransaction,
  vins: string[],
): Promise<void> {
  for (const chunk of chunkValues(vins, VIN_DELETE_CHUNK_SIZE)) {
    await tx.delete(vehicle).where(inArray(vehicle.vin, chunk));
  }
}

export async function reconcileFromFinalInventory(
  options: ReconcileOptions,
): Promise<ReconcileResult> {
  if (options.finalInventoryByVin.size === 0 && !options.allowAdvanceMissingState) {
    return {
      upsertedCount: 0,
      deletedCount: 0,
      missingUpdatedCount: 0,
      skippedMissingAdvance: true,
      timingsMs: {
        readExistingMs: 0,
        planMs: 0,
        upsertWriteMs: 0,
        missingWriteMs: 0,
      },
    };
  }

  const readExistingStartedAt = Date.now();
  const existingVehicles = await db.select().from(vehicle);
  const readExistingMs = Date.now() - readExistingStartedAt;

  const planStartedAt = Date.now();
  const plan = createReconcilePlan({
    finalInventoryByVin: options.finalInventoryByVin,
    existingVehicles,
    runTimestamp: options.runTimestamp,
    allowAdvanceMissingState: options.allowAdvanceMissingState,
    missingDeleteAfterRuns: options.missingDeleteAfterRuns,
    missingDeleteAfterMs: options.missingDeleteAfterMs,
  });
  const planMs = Date.now() - planStartedAt;

  let upsertWriteMs = 0;
  let missingWriteMs = 0;

  await db.transaction(async (tx) => {
    if (plan.changedUpserts.length > 0) {
      const upsertWriteStartedAt = Date.now();

      await insertVehicleChanges(
        tx,
        plan.changedUpserts.map((entry) => ({
          runId: options.runId,
          vin: entry.vehicle.vin,
          changeType: "upsert",
          payload: null,
          payloadVersion: 1,
          createdAt: options.runTimestamp,
        })),
      );

      await upsertVehicles(
        tx,
        plan.changedUpserts.map((entry) =>
          toVehicleRow({
            vehicle: entry.vehicle,
            firstSeenAt: entry.firstSeenAt,
            runTimestamp: options.runTimestamp,
          }),
        ),
      );

      upsertWriteMs = Date.now() - upsertWriteStartedAt;
    }

    if (plan.missingTransitions.length > 0) {
      const missingWriteStartedAt = Date.now();

      await insertVehicleChanges(
        tx,
        plan.missingTransitions.map((transition) => ({
          runId: options.runId,
          vin: transition.vin,
          changeType: transition.changeType,
          payload: null,
          payloadVersion: 1,
          createdAt: options.runTimestamp,
        })),
      );

      const missingOnly = plan.missingTransitions.filter(
        (transition) => transition.changeType === "missing",
      );
      if (missingOnly.length > 0) {
        await updateMissingVehicles(tx, missingOnly);
      }

      if (plan.deleteVins.length > 0) {
        await deleteVehiclesByVin(tx, plan.deleteVins);
      }

      missingWriteMs = Date.now() - missingWriteStartedAt;
    }
  });

  return {
    upsertedCount: plan.upsertedCount,
    deletedCount: plan.deleteVins.length,
    missingUpdatedCount: plan.missingTransitions.filter(
      (transition) => transition.changeType === "missing",
    ).length,
    skippedMissingAdvance: plan.skippedMissingAdvance,
    timingsMs: {
      readExistingMs,
      planMs,
      upsertWriteMs,
      missingWriteMs,
    },
  };
}
