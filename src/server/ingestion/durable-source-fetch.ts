import type { Yard } from "~/lib/yard";
import type { OnYards } from "./yard-metadata";
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
import { loadPullapartCachedEnrichments } from "./pullapart-enrichment-cache";
import { streamPypInventory } from "./pyp-connector";
import { streamRow52Inventory } from "./row52-connector";
import { loadConfiguredRow52YardExclusionIds } from "./row52-yard-exclusion";
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
  onYards: OnYards;
  yardsByCode: Map<string, Yard>;
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
  yardsByCode: Map<string, Yard>,
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
    yards: [...yardsByCode.values()],
  };
}

const DURABLE_SOURCE_FETCHERS: DurableSourceFetcherRegistry = {
  pyp: async (cursor, context) =>
    toFetchedChunk(
      await runIngestionEffect(
        streamPypInventory({
          onBatch: context.onBatch,
          onYards: context.onYards,
          startPage: cursor.page,
          maxPages: context.maxPages,
        }).pipe(Effect.scoped),
      ),
      (page) => ({ source: "pyp", page }),
      context.vehiclesByVin,
      context.yardsByCode,
    ),
  row52: async (cursor, context) =>
    toFetchedChunk(
      await runIngestionEffect(
        loadConfiguredRow52YardExclusionIds().pipe(
          Effect.flatMap((excludedLocationIds) =>
            streamRow52Inventory({
              onBatch: context.onBatch,
              onYards: context.onYards,
              cursor,
              excludedLocationIds,
              maxPages: context.maxPages,
            }),
          ),
          Effect.scoped,
        ),
      ),
      (nextCursor) => nextCursor,
      context.vehiclesByVin,
      context.yardsByCode,
    ),
  autorecycler: async (cursor, context) =>
    toFetchedChunk(
      await runIngestionEffect(
        streamAutorecyclerInventory({
          onBatch: context.onBatch,
          onYards: context.onYards,
          startFrom: cursor.from,
          maxPages: context.maxPages,
        }).pipe(Effect.scoped),
      ),
      (from) => ({ source: "autorecycler", from }),
      context.vehiclesByVin,
      context.yardsByCode,
    ),
  pullapart: async (cursor, context) =>
    toFetchedChunk(
      await runIngestionEffect(
        streamPullapartInventory({
          onBatch: context.onBatch,
          onYards: context.onYards,
          loadCachedEnrichments: loadPullapartCachedEnrichments,
          startAfter: cursor,
          maxPages: context.maxPages,
        }).pipe(Effect.scoped),
      ),
      (nextCursor) => nextCursor,
      context.vehiclesByVin,
      context.yardsByCode,
    ),
  upullitne: async (cursor, context) =>
    toFetchedChunk(
      await runIngestionEffect(
        streamTapInventory({
          onBatch: context.onBatch,
          onYards: context.onYards,
          startStoreIndex: cursor.storeIndex,
          maxPages: context.maxPages,
        }).pipe(Effect.scoped),
      ),
      (storeIndex) => ({ source: "upullitne", storeIndex }),
      context.vehiclesByVin,
      context.yardsByCode,
    ),
  upullitdavie: async (cursor, context) =>
    toFetchedChunk(
      await runIngestionEffect(
        streamUpullitDavieInventory({
          onBatch: context.onBatch,
          onYards: context.onYards,
          startCursor: cursor,
          maxPages: context.maxPages,
        }),
      ),
      (nextCursor) => ({ source: "upullitdavie", ...nextCursor }),
      context.vehiclesByVin,
      context.yardsByCode,
    ),
  gopullit: async (cursor, context) =>
    toFetchedChunk(
      await runIngestionEffect(
        streamGopullitInventory({
          onBatch: context.onBatch,
          onYards: context.onYards,
          startCursor: cursor,
          maxPages: context.maxPages,
        }),
      ),
      (nextCursor) => ({ source: "gopullit", ...nextCursor }),
      context.vehiclesByVin,
      context.yardsByCode,
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
  const yardsByCode = new Map<string, Yard>();
  const onYards: OnYards = (yards) =>
    Effect.sync(() => {
      for (const yard of yards) yardsByCode.set(yard.code, yard);
    });
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
    onYards,
    yardsByCode,
    vehiclesByVin,
  });
}
