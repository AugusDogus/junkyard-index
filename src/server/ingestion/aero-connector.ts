import { ingestionValidation } from "./ingestion-validation";
import { Effect, RateLimiter } from "effect";
import { AeroProviderError, fetchAeroPage } from "./aero-client";
import { AeroCursor, AeroCursorSchema } from "./aero-cursor";
import {
  parseAeroCatalog,
  parseAeroRecent,
  type AeroRecent,
} from "./aero-parser";
import {
  parseAeroStockNumber,
  transformAeroRecord,
  type AeroCanonicalVehicle,
} from "./aero-transform";
import { parseAeroYard, type AERO_YARD } from "./aero-yard-metadata";
import type { ConnectorChunkResult } from "./connector-chunk";
import { inventoryVin } from "./inventory-vin";
import type { ProviderRequestGate } from "./provider-http-client";
import { SourceValidationPolicy } from "./source-validation";

interface AeroOptions<E, R> {
  startCursor?: AeroCursor;
  maxPages?: number;
  onBatch: (vehicles: AeroCanonicalVehicle[]) => Effect.Effect<void, E, R>;
  onYards?: (yards: (typeof AERO_YARD)[]) => Effect.Effect<void, E, R>;
}
export type AeroStreamResult = ConnectorChunkResult<"aero", AeroCursor>;

function controlKey(r: AeroRecent): string {
  return JSON.stringify([
    r.year,
    r.make,
    r.model,
    r.engine,
    r.color,
    r.stock,
    r.row,
  ]);
}

export function streamAeroInventoryWithRequestGate<E, R>(
  options: AeroOptions<E, R>,
  gate: ProviderRequestGate,
) {
  return Effect.gen(function* () {
    const parsed = AeroCursorSchema.safeParse(
      options.startCursor ?? AeroCursor.initial,
    );
    const maxPages = options.maxPages ?? 1;
    if (
      !parsed.success ||
      !Number.isSafeInteger(maxPages) ||
      maxPages < 1 ||
      maxPages > 32
    )
      return yield* new AeroProviderError({
        operation: "checkpoint",
        cause:
          "Invalid Aero cursor or page budget; use the start cursor and 1-32 catalog pages",
      });
    const empty: AeroStreamResult = {
      source: "aero",
      status: "complete",
      cursor: { source: "aero", phase: "complete" },
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
    const home = yield* fetchAeroPage("/", gate);
    const directions = yield* fetchAeroPage("/directions/", gate);
    const html = yield* fetchAeroPage("/vehicle-inventory/", gate);
    const snapshot = yield* ingestionValidation({
      try: () => {
        const yard = parseAeroYard(home, directions);
        const controls = parseAeroRecent(home);
        const records = parseAeroCatalog(html);
        const stocks = new Set<string>();
        const vins = new Set<string>();
        const keys = new Map<string, number>();
        for (const record of records) {
          const vin = inventoryVin(record.vin, record.year);
          const stock = parseAeroStockNumber(record.stock);
          if (
            (stock !== null && stocks.has(stock)) ||
            (vin !== null && vins.has(vin))
          )
            throw new Error("Aero catalog has duplicate stock/VIN identities");
          if (stock) stocks.add(stock);
          if (vin) vins.add(vin);
          const key = controlKey(record);
          keys.set(key, (keys.get(key) ?? 0) + 1);
        }
        const controlStocks = new Set<string>();
        for (const control of controls) {
          const stock = parseAeroStockNumber(control.stock);
          const key = controlKey(control);
          const remaining = keys.get(key) ?? 0;
          if ((stock !== null && controlStocks.has(stock)) || remaining === 0)
            throw new Error(
              "Aero catalog did not recover unique homepage arrival controls; inventory may be partial or changed during the crawl",
            );
          if (stock) controlStocks.add(stock);
          keys.set(key, remaining - 1);
        }
        const vehicles: AeroCanonicalVehicle[] = [];
        const observedVins: string[] = [];
        let rejected = 0;
        for (const record of records) {
          const result = transformAeroRecord(record);
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
            "Aero catalog quality failed: " +
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
        new AeroProviderError({
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
            "Aero rejected " +
              snapshot.rejected +
              " incomplete or inconsistent donors; valid identities supply presence evidence only.",
          ]
        : [],
      accounting: {
        recordsProcessed: snapshot.processed,
        recordsExcluded: 0,
        recordsRejected: snapshot.rejected,
        duplicateVehicles: 0,
      },
    } satisfies AeroStreamResult;
  }).pipe(
    Effect.timeoutFail({
      duration: "2 minutes",
      onTimeout: () =>
        new AeroProviderError({
          operation: "catalog budget",
          cause:
            "Two-minute crawl limit exceeded; no complete checkpoint returned",
        }),
    }),
  );
}

export function streamAeroInventory<E, R>(options: AeroOptions<E, R>) {
  return Effect.scoped(
    RateLimiter.make({ limit: 1, interval: "1600 millis" }).pipe(
      Effect.flatMap((gate) =>
        streamAeroInventoryWithRequestGate(options, gate),
      ),
    ),
  );
}
