import { Effect } from "effect";
import { streamAutorecyclerInventory } from "./autorecycler-connector";
import { streamGopullitInventory } from "./gopullit-connector";
import type { FetchedDurableSourceChunk } from "./durable-ingestion-types";
import {
  getDurableSourceDefinition,
  type DurableCursorFor,
  type DurableIngestionSource,
} from "./durable-source";
import { streamPullapartInventory } from "./pullapart-connector";
import { streamPypInventory } from "./pyp-connector";
import { streamRow52Inventory } from "./row52-connector";
import { runIngestionEffect } from "./runtime";
import { streamTapInventory } from "./tap-inventory-connector";
import { streamUpullitDavieInventory } from "./upullit-davie-connector";
import type { CanonicalVehicle } from "./types";

type OnVehicleBatch = (
  vehicles: CanonicalVehicle[],
) => Effect.Effect<void, never, never>;

interface FetchContext {
  maxPages: number;
  onBatch: OnVehicleBatch;
  vehiclesByVin: Map<string, CanonicalVehicle>;
}

type DurableSourceFetcher<Source extends DurableIngestionSource> = (
  cursor: DurableCursorFor<Source>,
  context: FetchContext,
) => Promise<FetchedDurableSourceChunk<Source>>;

type DurableSourceFetcherRegistry = {
  [Source in DurableIngestionSource]: DurableSourceFetcher<Source>;
};

function toFetchedChunk<Source extends DurableIngestionSource, Cursor>(
  result: {
    status: "paused" | "complete" | "failed";
    cursor: Cursor;
    count: number;
    errors: string[];
    pagesProcessed: number;
  },
  toCursor: (cursor: Cursor) => DurableCursorFor<Source>,
  vehiclesByVin: Map<string, CanonicalVehicle>,
): FetchedDurableSourceChunk<Source> {
  const uniqueVehicles = vehiclesByVin.size;
  const rejectedVehicles = result.errors.length;
  return {
    cursor: toCursor(result.cursor),
    status: result.status,
    pagesProcessed: result.pagesProcessed,
    vehiclesProcessed: result.count,
    uniqueVehicles,
    duplicateVehicles: Math.max(
      0,
      result.count - uniqueVehicles - rejectedVehicles,
    ),
    rejectedVehicles,
    errors: result.errors,
    vehicles: [...vehiclesByVin.values()],
  };
}

const DURABLE_SOURCE_FETCHERS: DurableSourceFetcherRegistry = {
  pyp: async (cursor, context) =>
    toFetchedChunk(
      await runIngestionEffect(
        streamPypInventory({
          onBatch: context.onBatch,
          startPage: cursor.page,
          maxPages: context.maxPages,
        }).pipe(Effect.scoped),
      ),
      (page) => ({ source: "pyp", page }),
      context.vehiclesByVin,
    ),
  row52: async (cursor, context) =>
    toFetchedChunk(
      await runIngestionEffect(
        streamRow52Inventory({
          onBatch: context.onBatch,
          cursor,
          maxPages: context.maxPages,
        }).pipe(Effect.scoped),
      ),
      (nextCursor) => nextCursor,
      context.vehiclesByVin,
    ),
  autorecycler: async (cursor, context) =>
    toFetchedChunk(
      await runIngestionEffect(
        streamAutorecyclerInventory({
          onBatch: context.onBatch,
          startFrom: cursor.from,
          maxPages: context.maxPages,
        }).pipe(Effect.scoped),
      ),
      (from) => ({ source: "autorecycler", from }),
      context.vehiclesByVin,
    ),
  pullapart: async (cursor, context) =>
    toFetchedChunk(
      await runIngestionEffect(
        streamPullapartInventory({
          onBatch: context.onBatch,
          startAfter: cursor,
          maxPages: context.maxPages,
        }).pipe(Effect.scoped),
      ),
      (nextCursor) => nextCursor,
      context.vehiclesByVin,
    ),
  upullitne: async (cursor, context) =>
    toFetchedChunk(
      await runIngestionEffect(
        streamTapInventory({
          onBatch: context.onBatch,
          startStoreIndex: cursor.storeIndex,
          maxPages: context.maxPages,
        }).pipe(Effect.scoped),
      ),
      (storeIndex) => ({ source: "upullitne", storeIndex }),
      context.vehiclesByVin,
    ),
  upullitdavie: async (cursor, context) =>
    toFetchedChunk(
      await runIngestionEffect(
        streamUpullitDavieInventory({
          onBatch: context.onBatch,
          startCursor: cursor,
          maxPages: context.maxPages,
        }),
      ),
      (nextCursor) => ({ source: "upullitdavie", ...nextCursor }),
      context.vehiclesByVin,
    ),
  gopullit: async (cursor, context) =>
    toFetchedChunk(
      await runIngestionEffect(
        streamGopullitInventory({
          onBatch: context.onBatch,
          startCursor: cursor,
          maxPages: context.maxPages,
        }),
      ),
      (nextCursor) => ({ source: "gopullit", ...nextCursor }),
      context.vehiclesByVin,
    ),
};

function getDurableSourceFetcher<Source extends DurableIngestionSource>(
  source: Source,
): DurableSourceFetcher<Source> {
  return DURABLE_SOURCE_FETCHERS[source];
}

export async function fetchDurableSourceChunk<
  Source extends DurableIngestionSource,
>(
  cursor: DurableCursorFor<Source>,
): Promise<FetchedDurableSourceChunk<Source>> {
  const vehiclesByVin = new Map<string, CanonicalVehicle>();
  const onBatch = (vehicles: CanonicalVehicle[]) =>
    Effect.sync(() => {
      for (const vehicle of vehicles) {
        if (!vehiclesByVin.has(vehicle.vin))
          vehiclesByVin.set(vehicle.vin, vehicle);
      }
    });
  const maxPages = getDurableSourceDefinition(cursor.source).maxPagesPerChunk;
  return getDurableSourceFetcher(cursor.source)(cursor, {
    maxPages,
    onBatch,
    vehiclesByVin,
  });
}
