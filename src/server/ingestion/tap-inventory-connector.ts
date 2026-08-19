import { Effect } from "effect";
import {
  fetchTapBootstrap,
  fetchTapStores,
  searchTapInventory,
  UPULLITNE_SITE_CONFIG,
} from "./tap-inventory-client";
import type { ConnectorChunkResult } from "./connector-chunk";
import { TapInventoryProviderError } from "./errors";
import { transformTapInventoryProduct } from "./tap-inventory-transform";
import type { CanonicalVehicle } from "./types";

export type TapStreamResult = ConnectorChunkResult<"upullitne", number>;

export function streamTapInventory<E, R>(options: {
  onBatch: (vehicles: CanonicalVehicle[]) => Effect.Effect<void, E, R>;
  startStoreIndex?: number;
  maxPages?: number;
}): Effect.Effect<TapStreamResult, TapInventoryProviderError | E, R> {
  const loadConfig: Effect.Effect<
    typeof UPULLITNE_SITE_CONFIG,
    TapInventoryProviderError
  > = fetchTapBootstrap(UPULLITNE_SITE_CONFIG).pipe(
    Effect.mapError(
      (cause) =>
        new TapInventoryProviderError({ cursor: "site-config", cause }),
    ),
    Effect.map((bootstrap) => ({
      ...UPULLITNE_SITE_CONFIG,
      ajaxUrl: bootstrap.ajaxUrl,
      pluginUrl: bootstrap.pluginUrl,
    })),
  );

  return Effect.gen(function* () {
    const config = yield* loadConfig;
    let pagesProcessed = 0;
    let vehiclesProcessed = 0;
    const startStoreIndex = Math.max(0, options.startStoreIndex ?? 0);
    const maxPages = Math.max(1, options.maxPages ?? Number.MAX_SAFE_INTEGER);
    let nextStoreIndex = startStoreIndex;
    let failed = false;
    const errors: string[] = [];
    const globalSeen = new Map<string, CanonicalVehicle>();

    const stores = yield* fetchTapStores(config).pipe(
      Effect.mapError(
        (cause) => new TapInventoryProviderError({ cursor: "stores", cause }),
      ),
    );
    const concreteStores = stores.filter((store) => store.value !== "Any");

    if (concreteStores.length === 0) {
      return yield* Effect.fail(
        new TapInventoryProviderError({
          cursor: "stores",
          cause: new Error("TAP returned no concrete stores"),
        }),
      );
    }

    yield* Effect.logInfo(
      `[TAP/upullitne] Streaming inventory from ${concreteStores.length} stores`,
    );

    for (
      let storeIndex = startStoreIndex;
      storeIndex < concreteStores.length && pagesProcessed < maxPages;
      storeIndex += 1
    ) {
      const store = concreteStores[storeIndex]!;

      const storeConfig = config.storeLocations[store.value];
      if (!storeConfig) {
        const msg = `[TAP/upullitne] Missing store config for ${store.value}`;
        errors.push(msg);
        failed = true;
        break;
      }

      nextStoreIndex = storeIndex;

      const result = yield* searchTapInventory({
        config,
        store: store.value,
        make: "Any",
        model: "Any",
      }).pipe(
        Effect.mapError(
          (cause) =>
            new TapInventoryProviderError({
              cursor: String(nextStoreIndex),
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
      nextStoreIndex = storeIndex + 1;

      yield* Effect.logInfo(
        `[TAP/upullitne] Store ${store.value}: ${batch.length} vehicles`,
      );
    }

    const complete = !failed && nextStoreIndex >= concreteStores.length;

    return {
      source: "upullitne" as const,
      status: failed ? "failed" : complete ? "complete" : "paused",
      cursor: nextStoreIndex,
      count: vehiclesProcessed,
      errors,
      pagesProcessed,
    };
  });
}
