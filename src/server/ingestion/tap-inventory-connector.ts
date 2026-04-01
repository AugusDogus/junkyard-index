import { Effect } from "effect";
import {
  fetchTapBootstrap,
  fetchTapStores,
  searchTapInventory,
  UPULLITNE_SITE_CONFIG,
} from "./tap-inventory-client";
import { DEFAULT_INGESTION_PROGRESS_PAGE_INTERVAL } from "./constants";
import { TapInventoryProviderError } from "./errors";
import { transformTapInventoryProduct } from "./tap-inventory-transform";
import type { CanonicalVehicle } from "./types";

export interface TapStreamResult {
  source: "upullitne";
  count: number;
  errors: string[];
  pagesProcessed: number;
  nextCursor: string;
  done: boolean;
  fullyExhausted: boolean;
  stopped: boolean;
}

type TapProgress = {
  nextCursor: string;
  pagesProcessed: number;
  vehiclesProcessed: number;
  fullyExhausted: boolean;
  stopped: boolean;
  errors: string[];
};

export function streamTapInventory<E, R>(options: {
  onBatch: (vehicles: CanonicalVehicle[]) => Effect.Effect<void, E, R>;
  pagesPerChunk?: number;
  onProgress?: (progress: TapProgress) => Effect.Effect<void, E, R>;
}): Effect.Effect<TapStreamResult, TapInventoryProviderError | E, R> {
  const loadConfig: Effect.Effect<
    typeof UPULLITNE_SITE_CONFIG,
    TapInventoryProviderError
  > = fetchTapBootstrap(UPULLITNE_SITE_CONFIG).pipe(
    Effect.mapError(
      (cause) => new TapInventoryProviderError({ cursor: "site-config", cause }),
    ),
    Effect.map((bootstrap) => ({
      ...UPULLITNE_SITE_CONFIG,
      ajaxUrl: bootstrap.ajaxUrl,
      pluginUrl: bootstrap.pluginUrl,
    })),
  );

  return Effect.gen(function* () {
    const config = yield* loadConfig;
    const progressEveryPages = Math.max(
      1,
      options.pagesPerChunk ?? DEFAULT_INGESTION_PROGRESS_PAGE_INTERVAL,
    );
    let pagesProcessed = 0;
    let vehiclesProcessed = 0;
    let nextCursor = "0:0";
    let fullyExhausted = false;
    let stopped = false;
    let lastProgressPages = 0;
    const errors: string[] = [];
    const globalSeen = new Map<string, CanonicalVehicle>();

    const emitProgress = (force: boolean): Effect.Effect<void, E, R> => {
      if (!options.onProgress) return Effect.succeed(undefined);
      if (!force && pagesProcessed - lastProgressPages < progressEveryPages) {
        return Effect.succeed(undefined);
      }
      lastProgressPages = pagesProcessed;
      return options.onProgress({
        nextCursor,
        pagesProcessed,
        vehiclesProcessed,
        fullyExhausted,
        stopped,
        errors,
      });
    };

    const stores = yield* fetchTapStores(config).pipe(
      Effect.mapError(
        (cause) => new TapInventoryProviderError({ cursor: "stores", cause }),
      ),
    );

    yield* Effect.logInfo(
      `[TAP/upullitne] Streaming inventory from ${stores.length} stores`,
    );

    for (
      let storeIndex = 0;
      storeIndex < stores.length && !stopped;
      storeIndex += 1
    ) {
      const store = stores[storeIndex]!;
      if (store.value === "Any") continue;

      const storeConfig = config.storeLocations[store.value];
      if (!storeConfig) {
        const msg = `[TAP/upullitne] Missing store config for ${store.value}`;
        errors.push(msg);
        stopped = true;
        break;
      }

      nextCursor = `${store.value}:store`;

      const result = yield* searchTapInventory({
        config,
        store: store.value,
        make: "Any",
        model: "Any",
      }).pipe(
        Effect.mapError(
          (cause) =>
            new TapInventoryProviderError({
              cursor: nextCursor,
              cause,
            }),
        ),
      );

      const storeSeen = new Map<string, CanonicalVehicle>();
      for (const product of result.products) {
        const transformed = transformTapInventoryProduct(
          product,
          storeConfig,
          config,
        );
        if (!transformed) continue;
        storeSeen.set(transformed.vin, transformed);
      }

      const batch: CanonicalVehicle[] = [];
      for (const [vin, vehicle] of storeSeen) {
        if (globalSeen.has(vin)) continue;
        globalSeen.set(vin, vehicle);
        batch.push(vehicle);
      }
      if (batch.length > 0) {
        yield* options.onBatch(batch);
      }

      vehiclesProcessed += batch.length;
      pagesProcessed += 1;

      yield* Effect.logInfo(
        `[TAP/upullitne] Store ${store.value}: ${batch.length} vehicles`,
      );
      yield* emitProgress(false);
    }

    if (!stopped) {
      fullyExhausted = true;
      yield* emitProgress(true);
    }

    return {
      source: "upullitne" as const,
      count: vehiclesProcessed,
      errors,
      pagesProcessed,
      nextCursor,
      done: true,
      fullyExhausted,
      stopped,
    };
  });
}
