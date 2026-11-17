import { ingestionValidation } from "./ingestion-validation";
import { Effect, RateLimiter } from "effect";
import { ArmyProviderError, fetchArmyCatalog } from "./army-client";
import { ArmyCursor, ArmyCursorSchema } from "./army-cursor";
import { parseArmyCatalog } from "./army-parser";
import {
  parseArmyStockNumber,
  transformArmyRecord,
  type ArmyCanonicalVehicle,
} from "./army-transform";
import { ARMY_YARD } from "./army-yard-metadata";
import type { ConnectorChunkResult } from "./connector-chunk";
import { inventoryVin } from "./inventory-vin";
import type { ProviderRequestGate } from "./provider-http-client";
import { SourceValidationPolicy } from "./source-validation";

interface ArmyOptions<E, R> {
  startCursor?: ArmyCursor;
  maxPages?: number;
  onBatch: (vehicles: ArmyCanonicalVehicle[]) => Effect.Effect<void, E, R>;
  onYards?: (yards: (typeof ARMY_YARD)[]) => Effect.Effect<void, E, R>;
}
export type ArmyStreamResult = ConnectorChunkResult<"army", ArmyCursor>;

export function streamArmyInventoryWithRequestGate<E, R>(
  options: ArmyOptions<E, R>,
  gate: ProviderRequestGate,
) {
  return Effect.gen(function* () {
    const parsed = ArmyCursorSchema.safeParse(
      options.startCursor ?? ArmyCursor.initial,
    );
    const maxPages = options.maxPages ?? 1;
    if (
      !parsed.success ||
      !Number.isSafeInteger(maxPages) ||
      maxPages < 1 ||
      maxPages > 32
    )
      return yield* new ArmyProviderError({
        operation: "checkpoint",
        cause:
          "Invalid Army cursor or page budget; use the start cursor and a 1-32 catalog page budget",
      });
    const empty: ArmyStreamResult = {
      source: "army",
      status: "complete",
      cursor: { source: "army", phase: "complete" },
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
    const html = yield* fetchArmyCatalog(gate);
    const snapshot = yield* ingestionValidation({
      try: () => {
        const records = parseArmyCatalog(html);
        const vehicles = new Map<string, ArmyCanonicalVehicle>();
        const observedVins = new Set<string>();
        const descriptions = new Map<string, string>();
        const stocks = new Map<string, string>();
        let rejected = 0;
        let duplicates = 0;
        for (const record of records) {
          const vin = inventoryVin(record.vin, record.year);
          if (vin !== null) {
            const description = JSON.stringify([
              record.year,
              record.make.toUpperCase(),
              record.model.toUpperCase(),
            ]);
            const previous = descriptions.get(vin);
            if (previous !== undefined && previous !== description)
              throw new Error(
                "Army VIN " +
                  vin +
                  " has contradictory native year/make/model metadata",
              );
            descriptions.set(vin, description);
          }
          const stock = parseArmyStockNumber(record.stock);
          if (stock !== null) {
            const identity = record.vin.toUpperCase();
            const previous = stocks.get(stock);
            if (previous !== undefined && previous !== identity)
              throw new Error(
                "Army stock " +
                  stock +
                  " belongs to contradictory native identities",
              );
            stocks.set(stock, identity);
          }
          const result = transformArmyRecord(record);
          if (result.status === "incomplete") {
            rejected++;
            if (result.vin !== null) observedVins.add(result.vin);
            continue;
          }
          const previous = vehicles.get(result.vehicle.vin);
          if (previous !== undefined) {
            if (JSON.stringify(previous) !== JSON.stringify(result.vehicle))
              throw new Error(
                "Army VIN " +
                  result.vehicle.vin +
                  " has contradictory donor metadata",
              );
            duplicates++;
          } else vehicles.set(result.vehicle.vin, result.vehicle);
        }
        if (
          vehicles.size === 0 ||
          rejected / records.length >
            SourceValidationPolicy.maximumRejectionRatio
        )
          throw new Error(
            "Army catalog quality failed: " +
              rejected +
              " rejected of " +
              records.length +
              " rows; retain the 10% rejection limit",
          );
        if (
          duplicates / records.length >
          SourceValidationPolicy.maximumDuplicateRatio
        )
          throw new Error(
            "Army catalog quality failed: " +
              duplicates +
              " duplicates of " +
              records.length +
              " rows; retain the 25% duplicate limit",
          );
        return {
          vehicles: [...vehicles.values()],
          observedVins: [...observedVins],
          rejected,
          duplicates,
          processed: records.length,
        };
      },
      catch: (cause) =>
        new ArmyProviderError({
          operation: "complete catalog validation",
          cause,
        }),
    });
    if (options.onYards) yield* options.onYards([ARMY_YARD]);
    yield* options.onBatch(snapshot.vehicles);
    return {
      ...empty,
      count: snapshot.vehicles.length,
      pagesProcessed: 1,
      observedVins: snapshot.observedVins,
      warnings: snapshot.rejected
        ? [
            "Army rejected " +
              snapshot.rejected +
              " incomplete donors; valid identities supply presence evidence only.",
          ]
        : [],
      accounting: {
        recordsProcessed: snapshot.processed,
        recordsExcluded: 0,
        recordsRejected: snapshot.rejected,
        duplicateVehicles: snapshot.duplicates,
      },
    } satisfies ArmyStreamResult;
  }).pipe(
    Effect.timeoutFail({
      duration: "1 minute",
      onTimeout: () =>
        new ArmyProviderError({
          operation: "catalog budget",
          cause:
            "One-minute crawl limit exceeded; no complete checkpoint returned",
        }),
    }),
  );
}

export function streamArmyInventory<E, R>(options: ArmyOptions<E, R>) {
  return Effect.scoped(
    RateLimiter.make({ limit: 1, interval: "1600 millis" }).pipe(
      Effect.flatMap((gate) =>
        streamArmyInventoryWithRequestGate(options, gate),
      ),
    ),
  );
}
