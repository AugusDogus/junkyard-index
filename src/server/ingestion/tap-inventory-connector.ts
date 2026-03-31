import { Effect } from "effect";
import {
  fetchTapModels,
  fetchTapStores,
  searchTapInventory,
  UPULLITNE_SITE_CONFIG,
  type TapStoreOption,
} from "./tap-inventory-client";
import { DEFAULT_INGESTION_PROGRESS_PAGE_INTERVAL } from "./constants";
import { TapProviderError } from "./errors";
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

function makeTapCursor(store: string, make: string): string {
  return `${store}:${make}`;
}

export function streamTapInventory<E, R>(options: {
  onBatch: (vehicles: CanonicalVehicle[]) => Effect.Effect<void, E, R>;
  pagesPerChunk?: number;
  onProgress?: (progress: TapProgress) => Effect.Effect<void, E, R>;
}): Effect.Effect<TapStreamResult, TapProviderError | E, R> {
  return Effect.gen(function* () {
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

    const stores = yield* fetchTapStores(UPULLITNE_SITE_CONFIG).pipe(
      Effect.mapError(
        (cause) => new TapProviderError({ cursor: "stores", cause }),
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

      const storeConfig = UPULLITNE_SITE_CONFIG.storeLocations[store.value];
      if (!storeConfig) {
        const msg = `[TAP/upullitne] Missing store config for ${store.value}`;
        errors.push(msg);
        stopped = true;
        break;
      }

      const makes = UPULLITNE_SITE_CONFIG.makes;

      for (
        let makeIndex = 0;
        makeIndex < makes.length && !stopped;
        makeIndex += 1
      ) {
        const make = makes[makeIndex]!;
        nextCursor = makeTapCursor(store.value, make);

        const models = yield* fetchTapModels(UPULLITNE_SITE_CONFIG, make).pipe(
          Effect.mapError(
            (cause) =>
              new TapProviderError({
                cursor: `${nextCursor}:models`,
                cause,
              }),
          ),
        );

        const modelValues = ["Any", ...models.map((model) => model.value)];
        const seen = new Map<string, CanonicalVehicle>();

        for (const modelValue of modelValues) {
          const result = yield* searchTapInventory(UPULLITNE_SITE_CONFIG, {
            store: store.value,
            make,
            model: modelValue,
          }).pipe(
            Effect.mapError(
              (cause) =>
                new TapProviderError({
                  cursor: `${nextCursor}:${modelValue}`,
                  cause,
                }),
            ),
          );

          for (const product of result.products) {
            const transformed = transformTapInventoryProduct(
              product,
              storeConfig,
            );
            if (!transformed) continue;
            seen.set(transformed.vin, transformed);
          }
        }

        const batch = [...seen.values()];
        if (batch.length > 0) {
          yield* options.onBatch(batch);
        }

        vehiclesProcessed += batch.length;
        pagesProcessed += 1;

        yield* Effect.logInfo(
          `[TAP/upullitne] Store ${store.value} make ${make}: ${batch.length} vehicles`,
        );
        yield* emitProgress(false);
      }
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
