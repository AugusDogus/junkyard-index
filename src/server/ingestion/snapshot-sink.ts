import { sql } from "drizzle-orm";
import { db } from "~/lib/db";
import { vehicleSnapshot } from "~/schema";
import type { CanonicalVehicle } from "./types";

const SNAPSHOT_INSERT_CHUNK_SIZE = 32;

interface SnapshotJob {
  source: "pyp" | "row52";
  vehicles: CanonicalVehicle[];
}

interface SnapshotSinkOptions {
  runId: string;
  maxQueuedBatches?: number;
}

export interface SnapshotSink {
  enqueue(source: "pyp" | "row52", vehicles: CanonicalVehicle[]): Promise<void>;
  drain(): Promise<void>;
  stats(): { queuedBatches: number; flushedBatches: number; flushedVehicles: number };
}

function toSnapshotRow(
  runId: string,
  source: "pyp" | "row52",
  vehicle: CanonicalVehicle,
) {
  return {
    runId,
    source,
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
    createdAt: new Date(),
  };
}

async function writeSnapshotBatch(
  runId: string,
  source: "pyp" | "row52",
  vehicles: CanonicalVehicle[],
): Promise<void> {
  for (
    let index = 0;
    index < vehicles.length;
    index += SNAPSHOT_INSERT_CHUNK_SIZE
  ) {
    const chunk = vehicles.slice(index, index + SNAPSHOT_INSERT_CHUNK_SIZE);
    const rows = chunk.map((vehicle) => toSnapshotRow(runId, source, vehicle));
    await db
      .insert(vehicleSnapshot)
      .values(rows)
      .onConflictDoUpdate({
        target: [
          vehicleSnapshot.runId,
          vehicleSnapshot.source,
          vehicleSnapshot.vin,
        ],
        set: {
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
          createdAt: new Date(),
        },
      });
  }
}

export function createSnapshotSink(options: SnapshotSinkOptions): SnapshotSink {
  const maxQueuedBatches = options.maxQueuedBatches ?? 32;
  const queue: SnapshotJob[] = [];
  const queueWaiters: Array<() => void> = [];
  const drainWaiters: Array<() => void> = [];

  let running = false;
  let closedWithError: Error | null = null;
  let flushedBatches = 0;
  let flushedVehicles = 0;

  const notifyQueueSpace = (): void => {
    if (queue.length < maxQueuedBatches) {
      while (queueWaiters.length > 0) {
        const waiter = queueWaiters.shift();
        if (waiter) waiter();
      }
    }
  };

  const notifyDrain = (): void => {
    if (!running && queue.length === 0) {
      while (drainWaiters.length > 0) {
        const waiter = drainWaiters.shift();
        if (waiter) waiter();
      }
    }
  };

  const runLoop = async (): Promise<void> => {
    if (running || closedWithError) return;
    running = true;

    try {
      while (queue.length > 0) {
        const job = queue.shift();
        notifyQueueSpace();
        if (!job) continue;
        await writeSnapshotBatch(options.runId, job.source, job.vehicles);
        flushedBatches += 1;
        flushedVehicles += job.vehicles.length;
      }
    } catch (error) {
      closedWithError =
        error instanceof Error
          ? error
          : new Error(`Snapshot sink failed: ${String(error)}`);
    } finally {
      running = false;
      notifyDrain();
      if (queue.length > 0 && !closedWithError) {
        void runLoop();
      }
    }
  };

  const waitForSpace = async (): Promise<void> => {
    while (queue.length >= maxQueuedBatches) {
      await new Promise<void>((resolve) => {
        queueWaiters.push(resolve);
      });
      if (closedWithError) throw closedWithError;
    }
  };

  return {
    async enqueue(source, vehicles) {
      if (vehicles.length === 0) return;
      if (closedWithError) throw closedWithError;
      await waitForSpace();
      queue.push({ source, vehicles });
      void runLoop();
    },
    async drain() {
      if (closedWithError) throw closedWithError;
      if (!running && queue.length === 0) return;
      await new Promise<void>((resolve) => {
        drainWaiters.push(resolve);
      });
      if (closedWithError) throw closedWithError;
    },
    stats() {
      return {
        queuedBatches: queue.length,
        flushedBatches,
        flushedVehicles,
      };
    },
  };
}
