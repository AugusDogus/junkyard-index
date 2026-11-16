import { Clock, Effect } from "effect";
import type { IngestionSource } from "~/lib/ingestion-source";
import type { Yard } from "~/lib/yard";
import { ShopifyYardProviderError } from "./shopify-yard-client";
import {
  shopifyYardHash,
  shopifyYardCursor,
  type ShopifyYardDonor,
} from "./shopify-yard-cursor";
import { shopifyYardSnapshot } from "./shopify-yard-snapshot";
import type { CanonicalVehicle } from "./types";
import type { ConnectorChunkAccounting } from "./connector-chunk";

type CursorModule<S extends string> = ReturnType<typeof shopifyYardCursor<S>>;
export interface ShopifyYardOptions<E, R> {
  previousUniqueInventory: number | null;
  startCursor?: unknown;
  maxPages?: number;
  readPage?: (
    url: string,
    options: { deadline: number },
  ) => Effect.Effect<string, ShopifyYardProviderError>;
  onBatch: (vehicles: CanonicalVehicle[]) => Effect.Effect<void, E, R>;
  onYards?: (yards: Yard[]) => Effect.Effect<void, E, R>;
}
export function streamShopifyYard<S extends IngestionSource, E, R>(
  config: {
    source: S;
    cursor: CursorModule<S>;
    ownerUrl: string;
    catalogUrl: string;
    yard: Yard & { lat: number; lng: number };
    state: string;
    floor: number;
    readPage: (
      url: string,
      options: { deadline: number },
    ) => Effect.Effect<string, ShopifyYardProviderError>;
    parseOwner: (raw: string) => void;
    parseInventory: (raw: string) => ShopifyYardDonor[];
  },
  options: ShopifyYardOptions<E, R>,
) {
  const checked = <A>(operation: string, run: () => A) =>
    Effect.try({
      try: run,
      catch: (cause) =>
        new ShopifyYardProviderError(config.source, operation, cause),
    });
  return Effect.gen(function* () {
    const deadline = (yield* Clock.currentTimeMillis) + 180_000;
    const budget = options.maxPages ?? 4;
    if (
      !Number.isSafeInteger(budget) ||
      budget < 1 ||
      budget > 4 ||
      (options.previousUniqueInventory !== null &&
        (!Number.isSafeInteger(options.previousUniqueInventory) ||
          options.previousUniqueInventory < 0))
    )
      return yield* Effect.fail(
        new ShopifyYardProviderError(
          config.source,
          "run options",
          "Use 1 to 4 GETs and a nonnegative previous complete count or null",
        ),
      );
    let cursor = yield* checked("checkpoint", () =>
      config.cursor.parse(options.startCursor ?? config.cursor.initial()),
    );
    let pagesProcessed = 0;
    let result: {
      vehicles: CanonicalVehicle[];
      observedVins: string[];
      accounting: ConnectorChunkAccounting;
    } = {
      vehicles: [],
      observedVins: [],
      accounting: {
        recordsProcessed: 0,
        recordsExcluded: 0,
        recordsRejected: 0,
        duplicateVehicles: 0,
      },
    };
    while (cursor.phase !== "complete" && pagesProcessed < budget) {
      const current = cursor;
      const raw = yield* (options.readPage ?? config.readPage)(
        current.phase === "owner" || current.phase === "owner-closing"
          ? config.ownerUrl
          : config.catalogUrl,
        { deadline },
      );
      pagesProcessed++;
      if (current.phase === "owner") {
        yield* checked("opening physical owner", () => config.parseOwner(raw));
        cursor = config.cursor.checkpoint({ phase: "opening" });
      } else if (current.phase === "opening") {
        const rows = yield* checked("complete opening inventory", () => {
          const rows = config.parseInventory(raw);
          shopifyYardSnapshot(
            rows,
            config.yard,
            config.state,
            config.floor,
            options.previousUniqueInventory,
          );
          return rows;
        });
        cursor = config.cursor.checkpoint({ phase: "closing", rows });
      } else if (current.phase === "closing") {
        yield* checked("closing inventory", () => {
          const rows = config.parseInventory(raw);
          shopifyYardSnapshot(
            rows,
            config.yard,
            config.state,
            config.floor,
            options.previousUniqueInventory,
          );
          if (shopifyYardHash(rows) !== shopifyYardHash(current.rows))
            throw new Error(
              "Native donor membership, order, multiplicity, identity, metadata or availability changed before emission",
            );
        });
        cursor = config.cursor.checkpoint({
          phase: "owner-closing",
          rows: current.rows,
        });
      } else {
        result = yield* checked(
          "closing physical owner and validated inventory",
          () => {
            config.parseOwner(raw);
            return shopifyYardSnapshot(
              current.rows,
              config.yard,
              config.state,
              config.floor,
              options.previousUniqueInventory,
            );
          },
        );
        if (options.onYards) yield* options.onYards([{ ...config.yard }]);
        yield* options.onBatch(
          result.vehicles.map((vehicle) => ({ ...vehicle })),
        );
        cursor = config.cursor.checkpoint({ phase: "complete" });
      }
    }
    return {
      source: config.source,
      status:
        cursor.phase === "complete"
          ? ("complete" as const)
          : ("paused" as const),
      cursor,
      pagesProcessed,
      count: result.vehicles.length,
      accounting: result.accounting,
      observedVins: result.observedVins,
      errors: [],
      warnings: [],
    };
  }).pipe(
    Effect.timeoutFail({
      duration: "3 minutes",
      onTimeout: () =>
        new ShopifyYardProviderError(
          config.source,
          "chunk deadline",
          "Three-minute limit exceeded; honor any provider Retry-After before resuming",
        ),
    }),
  );
}
