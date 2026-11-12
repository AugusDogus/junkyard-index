import { Effect, RateLimiter } from "effect";
import { DdautoProviderError, fetchDdautoCatalog } from "./ddauto-client";
import { DdautoCursor, DdautoCursorSchema } from "./ddauto-cursor";
import {
  transformDdautoRecord,
  type DdautoCanonicalVehicle,
} from "./ddauto-transform";
import type { DdautoYard } from "./ddauto-yard-metadata";
import type { ConnectorChunkResult } from "./connector-chunk";
import { inventoryVin } from "./inventory-vin";
import type { ProviderRequestGate } from "./provider-http-client";
import { SourceValidationPolicy } from "./source-validation";

interface DdautoOptions<E, R> {
  startCursor?: DdautoCursor;
  maxPages?: number;
  onBatch: (vehicles: DdautoCanonicalVehicle[]) => Effect.Effect<void, E, R>;
  onYards?: (yards: DdautoYard[]) => Effect.Effect<void, E, R>;
}
export type DdautoStreamResult = ConnectorChunkResult<"ddauto", DdautoCursor>;

export function streamDdautoInventoryWithRequestGate<E, R>(
  options: DdautoOptions<E, R>,
  gate: ProviderRequestGate,
) {
  return Effect.gen(function* () {
    const parsed = DdautoCursorSchema.safeParse(
      options.startCursor ?? DdautoCursor.initial,
    );
    const maxPages = options.maxPages ?? 1;
    if (
      !parsed.success ||
      !Number.isSafeInteger(maxPages) ||
      maxPages < 1 ||
      maxPages > 32
    )
      return yield* new DdautoProviderError({
        operation: "checkpoint",
        cause:
          "Use a validated DD Auto cursor and a catalog budget from 1 to 32",
      });
    const empty: DdautoStreamResult = {
      source: "ddauto",
      status: "complete",
      cursor: { source: "ddauto", phase: "complete" },
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
    const catalog = yield* fetchDdautoCatalog(gate);
    const snapshot = yield* Effect.try({
      try: () => {
        const vehicles: DdautoCanonicalVehicle[] = [];
        const observedVins: string[] = [];
        const identities = new Map<string, "Parts" | "excluded">();
        let excluded = 0,
          rejected = 0;
        for (const record of catalog.records) {
          const vin = inventoryVin(record.vin, record.year);
          const active = record.status === "Parts" ? "Parts" : "excluded";
          const previous = vin ? identities.get(vin) : undefined;
          if (previous && (active === "Parts" || previous === "Parts"))
            throw new Error(
              "Native listings repeat an active VIN/serial or contradict its availability",
            );
          if (vin) identities.set(vin, active);
          const result = transformDdautoRecord(record);
          if (result.status === "available") vehicles.push(result.vehicle);
          else if (result.status === "excluded") excluded++;
          else {
            rejected++;
            if (result.vin) observedVins.push(result.vin);
          }
        }
        const activeRows = catalog.records.length - excluded;
        if (
          vehicles.length === 0 ||
          rejected / activeRows > SourceValidationPolicy.maximumRejectionRatio
        )
          throw new Error(
            rejected +
              " rejected of " +
              activeRows +
              " main-yard donors exceeds the unchanged 10% rejection limit or leaves no valid donors",
          );
        return { vehicles, observedVins, excluded, rejected };
      },
      catch: (cause) =>
        new DdautoProviderError({
          operation: "complete inventory validation",
          cause,
        }),
    });
    // Only a fully validated read can invoke callbacks or return the terminal cursor.
    yield* options.onBatch(snapshot.vehicles);
    if (options.onYards) yield* options.onYards([catalog.yard]);
    return {
      ...empty,
      count: snapshot.vehicles.length,
      pagesProcessed: 1,
      observedVins: snapshot.observedVins,
      warnings: snapshot.rejected
        ? [
            "DD Auto rejected incomplete required identities; valid VINs supply presence evidence only.",
          ]
        : [],
      accounting: {
        recordsProcessed: catalog.records.length,
        recordsExcluded: snapshot.excluded,
        recordsRejected: snapshot.rejected,
        duplicateVehicles: 0,
      },
    } satisfies DdautoStreamResult;
  }).pipe(
    Effect.timeoutFail({
      duration: "3 minutes",
      onTimeout: () =>
        new DdautoProviderError({
          operation: "catalog budget",
          cause:
            "Three-minute crawl limit exceeded; no complete checkpoint returned",
        }),
    }),
  );
}

export function streamDdautoInventory<E, R>(options: DdautoOptions<E, R>) {
  return Effect.scoped(
    RateLimiter.make({ limit: 1, interval: "1600 millis" }).pipe(
      Effect.flatMap((gate) =>
        streamDdautoInventoryWithRequestGate(options, gate),
      ),
    ),
  );
}
