import { tapYard, type OnYards } from "./yard-metadata";
import { Effect } from "effect";
import {
  fetchTapBootstrap,
  fetchTapStores,
  searchTapInventory,
} from "./tap-inventory-client";
import type { ConnectorChunkResult } from "./connector-chunk";
import { TapInventoryProviderError } from "./errors";
import {
  transformTapInventoryProduct,
  type TapCanonicalVehicle,
} from "./tap-inventory-transform";
import { UPULLITNE_SITE_CONFIG } from "./tap-sites";
import type { TapInventorySiteConfig } from "./tap-inventory-client";
import type { CanonicalVehicle } from "./types";

export type TapStreamResult = ConnectorChunkResult<"upullitne", number>;

export interface TapSiteStreamResult<Source extends string = string> {
  source: Source;
  status: "paused" | "complete" | "failed";
  cursor: number;
  count: number;
  errors: string[];
  pagesProcessed: number;
}

export function streamTapSiteInventory<Source extends string, E, R>(options: {
  config: TapInventorySiteConfig<Source>;
  onBatch: (
    vehicles: Array<TapCanonicalVehicle<Source>>,
  ) => Effect.Effect<void, E, R>;
  onYards?: OnYards;
  startStoreIndex?: number;
  maxPages?: number;
}): Effect.Effect<
  TapSiteStreamResult<Source>,
  TapInventoryProviderError | E,
  R
> {
  const config: TapInventorySiteConfig<Source> = options.config;

  const loadConfig: Effect.Effect<
    TapInventorySiteConfig<Source>,
    TapInventoryProviderError
  > = fetchTapBootstrap(config).pipe(
    Effect.mapError(
      (cause) =>
        new TapInventoryProviderError({ cursor: "site-config", cause }),
    ),
    Effect.map((bootstrap) => ({
      ...config,
      ajaxUrl: bootstrap.ajaxUrl,
      pluginUrl: bootstrap.pluginUrl,
    })),
  );

  return Effect.gen(function* () {
    const siteConfig = yield* loadConfig;
    let pagesProcessed = 0;
    let vehiclesProcessed = 0;
    const startStoreIndex = Math.max(0, options.startStoreIndex ?? 0);
    const maxPages = Math.max(1, options.maxPages ?? Number.MAX_SAFE_INTEGER);
    let nextStoreIndex = startStoreIndex;
    let failed = false;
    const errors: string[] = [];
    const globalSeen = new Map<string, TapCanonicalVehicle<Source>>();

    const stores = yield* fetchTapStores(siteConfig).pipe(
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
      `[TAP/${siteConfig.source}] Streaming inventory from ${concreteStores.length} stores`,
    );

    for (
      let storeIndex = startStoreIndex;
      storeIndex < concreteStores.length && pagesProcessed < maxPages;
      storeIndex += 1
    ) {
      const store = concreteStores[storeIndex]!;

      const storeConfig = siteConfig.storeLocations[store.value];
      if (!storeConfig) {
        const msg = `[TAP/${siteConfig.source}] Missing store config for ${store.value}`;
        errors.push(msg);
        failed = true;
        break;
      }

      if (options.onYards) yield* options.onYards([tapYard(storeConfig)]);
      nextStoreIndex = storeIndex;

      const result = yield* searchTapInventory({
        config: siteConfig,
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

      const storeSeen = new Map<string, TapCanonicalVehicle<Source>>();
      for (const product of result.products) {
        const transformed = transformTapInventoryProduct(
          product,
          storeConfig,
          siteConfig,
        );
        if (!transformed) continue;
        storeSeen.set(transformed.vin, transformed);
      }

      const batch: TapCanonicalVehicle<Source>[] = [];
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
        `[TAP/${siteConfig.source}] Store ${store.value}: ${batch.length} vehicles`,
      );
    }

    const complete = !failed && nextStoreIndex >= concreteStores.length;

    return {
      source: config.source,
      status: failed ? "failed" : complete ? "complete" : "paused",
      cursor: nextStoreIndex,
      count: vehiclesProcessed,
      errors,
      pagesProcessed,
    };
  });
}

export function streamTapInventory<E, R>(options: {
  onBatch: (vehicles: CanonicalVehicle[]) => Effect.Effect<void, E, R>;
  onYards?: OnYards;
  startStoreIndex?: number;
  maxPages?: number;
}): Effect.Effect<TapStreamResult, TapInventoryProviderError | E, R> {
  return streamTapSiteInventory<"upullitne", E, R>({
    ...options,
    config: UPULLITNE_SITE_CONFIG,
  });
}
