import { and, asc, eq, gt, inArray, isNull } from "drizzle-orm";
import { db } from "~/lib/db";
import {
  ingestionProjectorCheckpoint,
  vehicle,
  vehicleChange,
} from "~/schema";
import { syncToAlgolia } from "./sync-algolia";
import type { AlgoliaVehicleRecord, CanonicalVehicle } from "./types";
import { toAlgoliaRecord } from "./types";

const PROJECTOR_NAME = "vehicle_algolia";
const DEFAULT_BATCH_SIZE = 1000;
const VIN_QUERY_CHUNK_SIZE = 400;

export interface AlgoliaProjectorRunResult {
  batchesProcessed: number;
  changesProcessed: number;
  upsertsSynced: number;
  deletesSynced: number;
  lastProcessedChangeId: number;
}

export function mapDbVehicleToCanonical(
  row: typeof vehicle.$inferSelect,
): CanonicalVehicle {
  const source = row.source === "row52" ? "row52" : "pyp";
  return {
    vin: row.vin,
    source,
    year: row.year,
    make: row.make,
    model: row.model,
    color: row.color,
    stockNumber: row.stockNumber,
    imageUrl: row.imageUrl,
    availableDate: row.availableDate,
    locationCode: row.locationCode,
    locationName: row.locationName,
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

export function partitionVehicleChanges(
  changes: Array<{
    id: number;
    vin: string;
    changeType: string;
  }>,
): { deleteVins: string[]; upsertVins: string[] } {
  return {
    deleteVins: changes
      .filter((change) => change.changeType === "delete")
      .map((change) => change.vin),
    upsertVins: changes
      .filter((change) => change.changeType !== "delete")
      .map((change) => change.vin),
  };
}

async function ensureCheckpointRow(): Promise<void> {
  await db
    .insert(ingestionProjectorCheckpoint)
    .values({
      name: PROJECTOR_NAME,
    })
    .onConflictDoNothing({
      target: ingestionProjectorCheckpoint.name,
    });
}

async function getLastProcessedChangeId(): Promise<number> {
  const [checkpoint] = await db
    .select({
      lastProcessedChangeId: ingestionProjectorCheckpoint.lastProcessedChangeId,
    })
    .from(ingestionProjectorCheckpoint)
    .where(eq(ingestionProjectorCheckpoint.name, PROJECTOR_NAME))
    .limit(1);
  return checkpoint?.lastProcessedChangeId ?? 0;
}

async function updateCheckpoint(lastProcessedChangeId: number): Promise<void> {
  await db
    .update(ingestionProjectorCheckpoint)
    .set({
      lastProcessedChangeId,
      updatedAt: new Date(),
    })
    .where(eq(ingestionProjectorCheckpoint.name, PROJECTOR_NAME));
}

async function fetchVehicleRecords(vins: string[]): Promise<AlgoliaVehicleRecord[]> {
  if (vins.length === 0) return [];
  const uniqueVins = [...new Set(vins)];
  const rows: Array<typeof vehicle.$inferSelect> = [];

  for (
    let index = 0;
    index < uniqueVins.length;
    index += VIN_QUERY_CHUNK_SIZE
  ) {
    const vinChunk = uniqueVins.slice(index, index + VIN_QUERY_CHUNK_SIZE);
    const chunkRows = await db
      .select()
      .from(vehicle)
      .where(inArray(vehicle.vin, vinChunk));
    rows.push(...chunkRows);
  }

  return rows.map((row) =>
    toAlgoliaRecord(
      mapDbVehicleToCanonical(row),
      row.firstSeenAt,
      row.missingSinceAt,
      row.missingRunCount ?? 0,
    ),
  );
}

async function markChangesProcessed(changeIds: number[]): Promise<void> {
  if (changeIds.length === 0) return;

  for (
    let index = 0;
    index < changeIds.length;
    index += VIN_QUERY_CHUNK_SIZE
  ) {
    const idChunk = changeIds.slice(index, index + VIN_QUERY_CHUNK_SIZE);
    await db
      .update(vehicleChange)
      .set({
        processedAt: new Date(),
      })
      .where(
        and(
          inArray(vehicleChange.id, idChunk),
          isNull(vehicleChange.processedAt),
        ),
      );
  }
}

export async function runAlgoliaProjector(options?: {
  batchSize?: number;
  configureIndex?: boolean;
}): Promise<AlgoliaProjectorRunResult> {
  const batchSize = Math.max(1, options?.batchSize ?? DEFAULT_BATCH_SIZE);
  const shouldConfigureIndex = options?.configureIndex === true;

  await ensureCheckpointRow();
  let lastProcessedChangeId = await getLastProcessedChangeId();

  let batchesProcessed = 0;
  let changesProcessed = 0;
  let upsertsSynced = 0;
  let deletesSynced = 0;

  while (true) {
    const changes = await db
      .select({
        id: vehicleChange.id,
        vin: vehicleChange.vin,
        changeType: vehicleChange.changeType,
      })
      .from(vehicleChange)
      .where(gt(vehicleChange.id, lastProcessedChangeId))
      .orderBy(asc(vehicleChange.id))
      .limit(batchSize);

    if (changes.length === 0) {
      break;
    }

    const { deleteVins, upsertVins } = partitionVehicleChanges(changes);

    const upsertRecords = await fetchVehicleRecords(upsertVins);
    await syncToAlgolia(upsertRecords, deleteVins, {
      configureIndex: shouldConfigureIndex && batchesProcessed === 0,
    });

    const changeIds = changes.map((change) => change.id);
    await markChangesProcessed(changeIds);

    const batchLastId = changes[changes.length - 1]?.id ?? lastProcessedChangeId;
    lastProcessedChangeId = batchLastId;
    await updateCheckpoint(lastProcessedChangeId);

    batchesProcessed += 1;
    changesProcessed += changes.length;
    upsertsSynced += upsertRecords.length;
    deletesSynced += deleteVins.length;
  }

  return {
    batchesProcessed,
    changesProcessed,
    upsertsSynced,
    deletesSynced,
    lastProcessedChangeId,
  };
}
