import { ingestionValidation } from "./ingestion-validation";
import { Effect, RateLimiter } from "effect";
import { fetchRightwayPage, RightwayProviderError } from "./rightway-client";
import { RightwayCursor, RightwayCursorSchema } from "./rightway-cursor";
import {
  parseRightwayCatalog,
  parseRightwayPriceList,
  parseRightwayYard,
  validateRightwayPaginationScript,
} from "./rightway-parser";
import { inventoryVin } from "./inventory-vin";
import type { ConnectorChunkResult } from "./connector-chunk";
import type { ProviderRequestGate } from "./provider-http-client";
import { SourceValidationPolicy } from "./source-validation";
import {
  parseRightwayStockNumber,
  transformRightwayRecord,
  type RightwayCanonicalVehicle,
} from "./rightway-transform";
import {
  RIGHTWAY_SCRIPT_PATH,
  type RightwayYard,
} from "./rightway-yard-metadata";

interface RightwayOptions<E, R> {
  startCursor?: RightwayCursor;
  maxPages?: number;
  onBatch: (vehicles: RightwayCanonicalVehicle[]) => Effect.Effect<void, E, R>;
  onYards?: (yards: RightwayYard[]) => Effect.Effect<void, E, R>;
}
export type RightwayStreamResult = ConnectorChunkResult<
  "rightway",
  RightwayCursor
>;

export function streamRightwayInventoryWithRequestGate<E, R>(
  options: RightwayOptions<E, R>,
  gate: ProviderRequestGate,
) {
  return Effect.gen(function* () {
    const parsed = RightwayCursorSchema.safeParse(
      options.startCursor ?? RightwayCursor.initial,
    );
    const maxPages = options.maxPages ?? 1;
    if (
      !parsed.success ||
      !Number.isSafeInteger(maxPages) ||
      maxPages < 1 ||
      maxPages > 32
    )
      return yield* new RightwayProviderError({
        operation: "checkpoint",
        cause: "Use the start cursor and a catalog page budget from 1 to 32",
      });
    const empty: RightwayStreamResult = {
      source: "rightway",
      status: "complete",
      cursor: { source: "rightway", phase: "complete" },
      count: 0,
      pagesProcessed: 0,
      errors: [],
      warnings: [],
      observedVins: [],
      accounting: {
        recordsProcessed: 0,
        recordsExcluded: 0,
        recordsRejected: 0,
        duplicateVehicles: 0,
      },
    };
    if (parsed.data.phase === "complete") return empty;
    const home = yield* fetchRightwayPage("/", gate);
    const html = yield* fetchRightwayPage("/vehicle-search/", gate);
    const script = yield* fetchRightwayPage(RIGHTWAY_SCRIPT_PATH, gate);
    const snapshot = yield* ingestionValidation({
      try: () => {
        const yard = parseRightwayYard(home);
        const pricesUrl = parseRightwayPriceList(home);
        validateRightwayPaginationScript(script);
        const records = parseRightwayCatalog(html);
        const vins = new Set<string>();
        const stocks = new Set<string>();
        const urls = new Set<string>();
        const vehicles: RightwayCanonicalVehicle[] = [];
        const observedVins: string[] = [];
        let rejected = 0;
        for (const record of records) {
          const vin = inventoryVin(record.vin, record.year);
          const stock = parseRightwayStockNumber(record.stock);
          if (
            (vin !== null && vins.has(vin)) ||
            (stock !== null && stocks.has(stock)) ||
            urls.has(record.nativeUrl)
          )
            throw new Error(
              "Rightway catalog has duplicate valid VIN, stock or native donor URL identities",
            );
          if (vin) vins.add(vin);
          if (stock) stocks.add(stock);
          urls.add(record.nativeUrl);
          const result = transformRightwayRecord(record, pricesUrl);
          if (result.status === "available") vehicles.push(result.vehicle);
          else {
            rejected++;
            if (result.vin) observedVins.push(result.vin);
          }
        }
        if (
          vehicles.length === 0 ||
          rejected / records.length >
            SourceValidationPolicy.maximumRejectionRatio
        )
          throw new Error(
            "Rightway catalog quality failed: " +
              rejected +
              " rejected of " +
              records.length +
              " rows; retain the 10% rejection limit",
          );
        return {
          yard,
          vehicles,
          observedVins,
          rejected,
          processed: records.length,
        };
      },
      catch: (cause) =>
        new RightwayProviderError({
          operation: "complete catalog validation",
          cause,
        }),
    });
    if (options.onYards) yield* options.onYards([snapshot.yard]);
    yield* options.onBatch(snapshot.vehicles);
    return {
      ...empty,
      count: snapshot.vehicles.length,
      pagesProcessed: 1,
      observedVins: snapshot.observedVins,
      warnings: snapshot.rejected
        ? [
            "Rightway rejected incomplete required donor identities; independently valid VINs supply presence evidence only.",
          ]
        : [],
      accounting: {
        recordsProcessed: snapshot.processed,
        recordsExcluded: 0,
        recordsRejected: snapshot.rejected,
        duplicateVehicles: 0,
      },
    } satisfies RightwayStreamResult;
  }).pipe(
    Effect.timeoutFail({
      duration: "2 minutes",
      onTimeout: () =>
        new RightwayProviderError({
          operation: "catalog budget",
          cause:
            "Two-minute crawl limit exceeded; no complete checkpoint returned",
        }),
    }),
  );
}
export function streamRightwayInventory<E, R>(options: RightwayOptions<E, R>) {
  return Effect.scoped(
    RateLimiter.make({ limit: 1, interval: "1600 millis" }).pipe(
      Effect.flatMap((gate) =>
        streamRightwayInventoryWithRequestGate(options, gate),
      ),
    ),
  );
}
