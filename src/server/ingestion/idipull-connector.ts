import { ingestionValidation } from "./ingestion-validation";
import { Effect, RateLimiter } from "effect";
import type { ConnectorChunkResult } from "./connector-chunk";
import { fetchIdipullPage, IdipullProviderError } from "./idipull-client";
import { IdipullCursor, IdipullCursorSchema } from "./idipull-cursor";
import { parseIdipullYard, type IdipullRecord } from "./idipull-parser";
import {
  transformIdipullRecord,
  type IdipullCanonicalVehicle,
} from "./idipull-transform";
import type { IdipullYard } from "./idipull-yard-metadata";
import { IdipullCatalog } from "./idipull-catalog";
import { inventoryVin } from "./inventory-vin";
import { ProviderChunkClock } from "./provider-chunk-clock";
import type { ProviderRequestGate } from "./provider-http-client";
import { SourceValidationPolicy } from "./source-validation";
import { conflictingVins } from "./vin-conflicts";

interface IdipullOptions<E, R> {
  startCursor?: IdipullCursor;
  asOf?: Date;
  maxPages?: number;
  onBatch: (vehicles: IdipullCanonicalVehicle[]) => Effect.Effect<void, E, R>;
  onYards?: (yards: IdipullYard[]) => Effect.Effect<void, E, R>;
}
export type IdipullStreamResult = ConnectorChunkResult<
  "idipull",
  IdipullCursor
>;

function validateCatalog(catalog: IdipullCatalog, asOf: Date) {
  const records = catalog.records;
  const groups = new Map<string, IdipullRecord[]>();
  for (const record of records) {
    const vin = inventoryVin(record.vin, record.year);
    if (vin) {
      const rows = groups.get(vin) ?? [];
      rows.push(record);
      groups.set(vin, rows);
    }
  }
  const repeated = [...groups.entries()].filter(([, rows]) => rows.length > 1);
  const duplicateExtra = repeated.reduce(
    (count, [, rows]) => count + rows.length - 1,
    0,
  );
  if (
    duplicateExtra / records.length >
    SourceValidationPolicy.maximumDuplicateRatio
  ) {
    throw new Error(
      "Idaho Falls catalog exceeds the unchanged 25% duplicate limit",
    );
  }
  // Reject every conflicting copy. Native stocks are not a tie-breaker for a
  // repeated VIN, even when its required YMM happens to agree.
  const conflicts = conflictingVins(records, (record) => {
    const vin = inventoryVin(record.vin, record.year);
    return vin ? { vin, signature: JSON.stringify(record) } : null;
  });
  const seen = new Set<string>();
  const stocks = new Map<string, string>();
  const observedVins = new Set<string>();
  const vehicles: IdipullCanonicalVehicle[] = [];
  let rejected = 0;
  let duplicates = 0;
  for (const record of records) {
    const result = transformIdipullRecord(record, catalog.updated);
    const vin = inventoryVin(record.vin, record.year);
    if (vin && conflicts.has(vin)) {
      rejected++;
      observedVins.add(vin);
    } else if (vin && seen.has(vin)) {
      duplicates++;
    } else {
      if (vin) seen.add(vin);
      if (result.status === "incomplete") {
        rejected++;
        if (result.vin) observedVins.add(result.vin);
      } else {
        const stock = result.vehicle.stockNumber;
        if (stock && stocks.has(stock)) {
          throw new Error(
            "Idaho Falls repeats a native stock across different VINs; resolve source identity before retrying",
          );
        }
        if (stock) stocks.set(stock, result.vehicle.vin);
        vehicles.push(result.vehicle);
      }
    }
  }
  if (
    vehicles.length === 0 ||
    rejected / records.length > SourceValidationPolicy.maximumRejectionRatio
  ) {
    throw new Error(
      "Idaho Falls catalog quality failed: " +
        rejected +
        " rejected of " +
        records.length +
        " rows; retain the 10% rejection limit",
    );
  }
  IdipullCatalog.validateCurrency(
    catalog,
    vehicles.map((vehicle) => vehicle.availableDate),
    asOf,
  );
  return { vehicles, observedVins: [...observedVins], rejected, duplicates };
}

export function streamIdipullInventoryWithRequestGate<E, R>(
  options: IdipullOptions<E, R>,
  gate: ProviderRequestGate,
) {
  return Effect.gen(function* () {
    const parsed = IdipullCursorSchema.safeParse(
      options.startCursor ?? IdipullCursor.initial,
    );
    const maxPages = options.maxPages ?? 1;
    if (
      !parsed.success ||
      !Number.isSafeInteger(maxPages) ||
      maxPages < 1 ||
      maxPages > 32
    ) {
      return yield* new IdipullProviderError({
        operation: "checkpoint",
        cause: "Use a valid start cursor and a catalog budget from 1 to 32",
      });
    }
    const empty: IdipullStreamResult = {
      source: "idipull",
      status: "complete",
      cursor: { source: "idipull", phase: "complete" },
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
    // The closing read must match the opening read.
    const [home, html, closingHtml] = yield* Effect.all([
      fetchIdipullPage("/", gate),
      fetchIdipullPage("/inventory/", gate),
      fetchIdipullPage("/inventory/", gate),
    ]);
    const snapshot = yield* ingestionValidation({
      try: () => {
        const yard = parseIdipullYard(home);
        const opening = IdipullCatalog.parse(html);
        const closing = IdipullCatalog.parse(closingHtml);
        if (
          IdipullCatalog.signature(opening) !==
          IdipullCatalog.signature(closing)
        )
          throw new Error(
            "Idaho Falls closing inventory changed native rows or its update label; restart with fresh opening evidence",
          );
        return {
          yard,
          processed: opening.records.length,
          ...validateCatalog(opening, options.asOf ?? new Date()),
        };
      },
      catch: (cause) =>
        new IdipullProviderError({
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
            "Idaho Falls rejected incomplete or conflicting donor rows; valid rejected VINs supply presence evidence only.",
          ]
        : [],
      accounting: {
        recordsProcessed: snapshot.processed,
        recordsExcluded: 0,
        recordsRejected: snapshot.rejected,
        duplicateVehicles: snapshot.duplicates,
      },
    } satisfies IdipullStreamResult;
  }).pipe(
    ProviderChunkClock.deadline({
      duration: "2 minutes",
      onTimeout: () =>
        new IdipullProviderError({
          operation: "catalog budget",
          cause:
            "Two-minute crawl limit exceeded; no complete checkpoint returned",
        }),
    }),
  );
}

export function streamIdipullInventory<E, R>(options: IdipullOptions<E, R>) {
  return Effect.scoped(
    RateLimiter.make({ limit: 1, interval: "1600 millis" }).pipe(
      Effect.flatMap((gate) =>
        streamIdipullInventoryWithRequestGate(options, gate),
      ),
    ),
  );
}
