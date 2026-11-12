import { Effect, RateLimiter } from "effect";
import {
  fetchMidwayCatalog,
  fetchMidwayHome,
  MidwayProviderError,
} from "./midway-client";
import { MidwayCursor, MidwayCursorSchema } from "./midway-cursor";
import { parseMidwayCatalog } from "./midway-parser";
import {
  parseMidwayStockNumber,
  transformMidwayRecord,
  type MidwayCanonicalVehicle,
} from "./midway-transform";
import {
  MIDWAY_YARDS,
  parseMidwayYards,
  type MidwayYard,
} from "./midway-yard-metadata";
import type { ConnectorChunkResult } from "./connector-chunk";
import { inventoryVin } from "./inventory-vin";
import type { ProviderRequestGate } from "./provider-http-client";
import { SourceValidationPolicy } from "./source-validation";

interface MidwayOptions<E, R> {
  startCursor?: MidwayCursor;
  maxPages?: number;
  onBatch: (vehicles: MidwayCanonicalVehicle[]) => Effect.Effect<void, E, R>;
  onYards?: (yards: MidwayYard[]) => Effect.Effect<void, E, R>;
}
export type MidwayStreamResult = ConnectorChunkResult<"midway", MidwayCursor>;

/** One page unit validates and emits one complete selected physical yard. */
export function streamMidwayInventoryWithRequestGate<E, R>(
  options: MidwayOptions<E, R>,
  gate: ProviderRequestGate,
) {
  return Effect.gen(function* () {
    const parsed = MidwayCursorSchema.safeParse(
      options.startCursor ?? MidwayCursor.initial,
    );
    const maxPages = options.maxPages ?? 2;
    if (
      !parsed.success ||
      !Number.isSafeInteger(maxPages) ||
      maxPages < 1 ||
      maxPages > 32
    )
      return yield* new MidwayProviderError({
        operation: "checkpoint",
        cause: "Use a validated Midway cursor and 1-32 yard-page units",
      });
    let cursor: MidwayCursor = parsed.data;
    let count = 0;
    let pagesProcessed = 0;
    const observedVins: string[] = [];
    const accounting = {
      recordsProcessed: 0,
      recordsExcluded: 0,
      recordsRejected: 0,
      duplicateVehicles: 0,
    };
    if (cursor.phase !== "complete") {
      const home = yield* fetchMidwayHome(gate);
      yield* Effect.try({
        try: () => parseMidwayYards(home),
        catch: (cause) =>
          new MidwayProviderError({ operation: "native yard identity", cause }),
      });
    }
    while (cursor.phase === "yard" && pagesProcessed < maxPages) {
      const code = cursor.yardCode;
      const previousVins = cursor.observedVins;
      const previousStocks = cursor.stocks;
      const html = yield* fetchMidwayCatalog(code, gate);
      const snapshot = yield* Effect.try({
        try: () => {
          const records = parseMidwayCatalog(html, code);
          const vins = new Set(previousVins);
          const stocks = new Set(previousStocks);
          const vehicles: MidwayCanonicalVehicle[] = [];
          const rejectedVins: string[] = [];
          let rejected = 0;
          for (const record of records) {
            const vin = inventoryVin(record.vin, record.year);
            const stock = parseMidwayStockNumber(record.stock);
            if (
              (vin !== null && vins.has(vin)) ||
              (stock !== null && stocks.has(stock))
            )
              throw new Error(
                "Duplicate native stock/VIN within or across selected Midway yards",
              );
            if (vin) vins.add(vin);
            if (stock) stocks.add(stock);
            const result = transformMidwayRecord(record, code);
            if (result.status === "available") vehicles.push(result.vehicle);
            else {
              rejected++;
              if (result.vin) rejectedVins.push(result.vin);
            }
          }
          if (
            !vehicles.length ||
            rejected / records.length >
              SourceValidationPolicy.maximumRejectionRatio
          )
            throw new Error(
              `${rejected} rejected of ${records.length} donors exceeds the 10% rejection limit or leaves no accepted donor`,
            );
          return {
            vehicles,
            rejectedVins,
            rejected,
            processed: records.length,
            vins: [...vins],
            stocks: [...stocks],
          };
        },
        catch: (cause) =>
          new MidwayProviderError({
            operation: "yard " + code + " complete inventory validation",
            cause,
          }),
      });
      if (options.onYards) yield* options.onYards([MIDWAY_YARDS[code]]);
      yield* options.onBatch(snapshot.vehicles);
      count += snapshot.vehicles.length;
      accounting.recordsProcessed += snapshot.processed;
      accounting.recordsRejected += snapshot.rejected;
      observedVins.push(...snapshot.rejectedVins);
      pagesProcessed++;
      cursor =
        code === "MO38"
          ? {
              source: "midway",
              phase: "yard",
              yardCode: "MO09",
              observedVins: snapshot.vins,
              stocks: snapshot.stocks,
            }
          : { source: "midway", phase: "complete" };
    }
    return {
      source: "midway",
      status: cursor.phase === "complete" ? "complete" : "paused",
      cursor,
      count,
      pagesProcessed,
      errors: [],
      warnings: accounting.recordsRejected
        ? [
            "Midway rejected incomplete required donor records; valid rejected identities supply presence evidence only.",
          ]
        : [],
      observedVins,
      accounting,
    } satisfies MidwayStreamResult;
  }).pipe(
    Effect.timeoutFail({
      duration: "2 minutes",
      onTimeout: () =>
        new MidwayProviderError({
          operation: "catalog budget",
          cause:
            "Two-minute crawl limit exceeded; no completed checkpoint returned",
        }),
    }),
  );
}

export function streamMidwayInventory<E, R>(options: MidwayOptions<E, R>) {
  return Effect.scoped(
    RateLimiter.make({ limit: 1, interval: "1600 millis" }).pipe(
      Effect.flatMap((gate) =>
        streamMidwayInventoryWithRequestGate(options, gate),
      ),
    ),
  );
}
