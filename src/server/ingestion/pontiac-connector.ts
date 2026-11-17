import { ingestionValidation } from "./ingestion-validation";
import { Data, Effect, RateLimiter } from "effect";
import type { Yard } from "~/lib/yard";
import type { ConnectorChunkResult } from "./connector-chunk";
import { mergePontiacMappings, pontiacQueries } from "./pontiac-catalog";
import {
  fetchPontiacControls,
  fetchPontiacDetail,
  fetchPontiacMakes,
  fetchPontiacModels,
  fetchPontiacSearch,
  fetchPontiacYard,
  fetchPontiacYears,
  PontiacProviderError,
} from "./pontiac-client";
import { PontiacCursor, PontiacCursorSchema } from "./pontiac-cursor";
import {
  pontiacColor,
  pontiacComparable,
  samePontiacSearch,
} from "./pontiac-record";
import type { ProviderRequestGate } from "./provider-http-client";
import { SourceValidationPolicy } from "./source-validation";
import {
  transformPontiacRecord,
  type PontiacCanonicalVehicle,
} from "./pontiac-transform";

export class PontiacStreamError extends Data.TaggedError("PontiacStreamError")<{
  message: string;
}> {}
interface PontiacOptions<E, R> {
  startCursor?: PontiacCursor;
  maxPages?: number;
  onBatch: (vehicles: PontiacCanonicalVehicle[]) => Effect.Effect<void, E, R>;
  onYards?: (yards: Yard[]) => Effect.Effect<void, E, R>;
}
export type PontiacStreamResult = ConnectorChunkResult<
  "pontiac",
  PontiacCursor
>;
const failure = (message: string) =>
  new PontiacStreamError({
    message:
      "Pontiac " +
      message +
      "; no advanced checkpoint accepted. Previously published inventory is preserved. Inspect the provider response and retry the last validated checkpoint.",
  });

export function streamPontiacInventoryWithRequestGate<E, R>(
  options: PontiacOptions<E, R>,
  gate: ProviderRequestGate,
) {
  return Effect.gen(function* () {
    const parsed = PontiacCursorSchema.safeParse(
      options.startCursor ?? PontiacCursor.initial,
    );
    const maxPages = options.maxPages ?? 16;
    if (
      !parsed.success ||
      !Number.isSafeInteger(maxPages) ||
      maxPages < 1 ||
      maxPages > 32
    )
      return yield* failure(
        "checkpoint or request budget is invalid, expected a validated cursor and 1-32 requests",
      );
    let cursor: PontiacCursor = parsed.data;
    let pagesProcessed = 0;
    let count = 0;
    const observedVins = new Set<string>();
    const accounting = {
      recordsProcessed: 0,
      recordsExcluded: 0,
      recordsRejected: 0,
      duplicateVehicles: 0,
    };
    while (cursor.phase !== "complete" && pagesProcessed < maxPages) {
      switch (cursor.phase) {
        case "start": {
          const yard = yield* fetchPontiacYard(gate);
          if (options.onYards) yield* options.onYards([yard]);
          cursor = { source: "pontiac", phase: "controls" };
          break;
        }
        case "controls":
          cursor = {
            source: "pontiac",
            phase: "years",
            controls: yield* fetchPontiacControls(gate),
          };
          break;
        case "years": {
          const years = (yield* fetchPontiacYears(gate))
            .map((y) => y.modelYear)
            .sort((a, b) => b - a);
          cursor = {
            source: "pontiac",
            phase: "makes",
            controls: cursor.controls,
            years,
            index: 0,
            pairs: [],
          };
          break;
        }
        case "makes": {
          const year = cursor.years[cursor.index];
          if (year === undefined)
            return yield* failure("year checkpoint has no current directory");
          const makes = yield* fetchPontiacMakes(year, gate);
          const pairs = [
            ...cursor.pairs,
            ...makes.map((m) => ({ year, make: m.vehicleMake })),
          ];
          if (cursor.index + 1 === cursor.years.length) {
            if (pairs.length === 0)
              return yield* failure("native make directories were all empty");
            cursor = {
              source: "pontiac",
              phase: "models",
              controls: cursor.controls,
              pairs,
              index: 0,
              mappings: [],
            };
          } else cursor = { ...cursor, index: cursor.index + 1, pairs };
          break;
        }
        case "models": {
          const pair = cursor.pairs[cursor.index];
          if (!pair)
            return yield* failure(
              "model checkpoint has no current year/make directory",
            );
          const models = yield* fetchPontiacModels(pair.year, pair.make, gate);
          const mappings = mergePontiacMappings(
            cursor.mappings,
            models.map((m) => ({ ...pair, ...m })),
          );
          if (cursor.index + 1 === cursor.pairs.length) {
            const queries = pontiacQueries(mappings);
            if (queries.length === 0)
              return yield* failure("native model directories were all empty");
            cursor = {
              source: "pontiac",
              phase: "search",
              controls: cursor.controls,
              queries,
              index: 0,
              donors: [],
            };
          } else cursor = { ...cursor, index: cursor.index + 1, mappings };
          break;
        }
        case "search": {
          const query = cursor.queries[cursor.index];
          if (!query)
            return yield* failure(
              "search checkpoint has no current native query",
            );
          const rows = yield* fetchPontiacSearch(query, gate);
          const donors = new Map(cursor.donors.map((d) => [d.vehicleID, d]));
          const stocks = new Map(
            cursor.donors.flatMap((d) =>
              d.stockID ? [[d.stockID, d.vehicleID] as const] : [],
            ),
          );
          for (const row of rows) {
            const previous = donors.get(row.vehicleID);
            if (
              (previous && !samePontiacSearch(previous, row)) ||
              (row.stockID &&
                stocks.has(row.stockID) &&
                stocks.get(row.stockID) !== row.vehicleID)
            )
              return yield* failure(
                "searches disagree on donor or stock identity " + row.vehicleID,
              );
            donors.set(row.vehicleID, {
              ...row,
              stockID: row.stockID ?? previous?.stockID ?? null,
              colorOfVehicle:
                pontiacColor(row.colorOfVehicle) ??
                pontiacColor(previous?.colorOfVehicle),
              yardRow: row.yardRow ?? previous?.yardRow ?? null,
            });
            if (row.stockID) stocks.set(row.stockID, row.vehicleID);
          }
          if (cursor.index + 1 === cursor.queries.length) {
            for (const control of cursor.controls) {
              const donor = donors.get(control.vehicleID);
              if (
                !donor ||
                donor.modelYear !== control.modelYear ||
                pontiacComparable(donor.modelMake) !==
                  pontiacComparable(control.vehicleMake) ||
                pontiacComparable(donor.modelName) !==
                  pontiacComparable(control.modelName)
              )
                return yield* failure(
                  "search enumeration did not recover recent-arrival control " +
                    control.vehicleID,
                );
            }
            cursor = {
              source: "pontiac",
              phase: "details",
              donors: [...donors.values()],
              index: 0,
              excluded: 0,
              rejected: 0,
              emitted: 0,
              vins: [],
              images: [],
            };
          } else
            cursor = {
              ...cursor,
              index: cursor.index + 1,
              donors: [...donors.values()],
            };
          break;
        }
        case "details": {
          const donor = cursor.donors[cursor.index];
          if (!donor)
            return yield* failure("detail checkpoint has no current donor");
          const detail = yield* fetchPontiacDetail(donor.vehicleID, gate);
          const result =
            detail === null
              ? { status: "unavailable" as const }
              : yield* ingestionValidation({
                  try: () => transformPontiacRecord(donor, detail),
                  catch: (cause) =>
                    new PontiacProviderError({
                      operation: "donor " + donor.vehicleID,
                      cause,
                    }),
                });
          const next = {
            ...cursor,
            index: cursor.index + 1,
            vins: [...cursor.vins],
            images: [...cursor.images],
          };
          const stock = detail?.stockID ?? donor.stockID ?? null;
          if (stock !== null) {
            if (
              next.donors.some(
                (d) => d.vehicleID !== donor.vehicleID && d.stockID === stock,
              )
            )
              return yield* failure("different donors reuse stock " + stock);
            next.donors = next.donors.map((d) =>
              d.vehicleID === donor.vehicleID ? { ...d, stockID: stock } : d,
            );
          }
          accounting.recordsProcessed++;
          if (result.status === "unavailable") {
            next.excluded++;
            accounting.recordsExcluded++;
          } else {
            const vin =
              result.status === "available" ? result.vehicle.vin : result.vin;
            if (vin) {
              if (next.vins.includes(vin))
                return yield* failure("different donor IDs reuse VIN " + vin);
              next.vins.push(vin);
            }
            if (result.status === "incomplete") {
              next.rejected++;
              accounting.recordsRejected++;
              if (vin) observedVins.add(vin);
            } else {
              const image = result.vehicle.imageUrl;
              if (image) {
                if (next.images.includes(image))
                  return yield* failure(
                    "different donors reuse the same photo",
                  );
                next.images.push(image);
              }
              next.emitted++;
            }
          }
          const terminal = next.index === next.donors.length;
          if (
            terminal &&
            (next.emitted === 0 ||
              next.rejected / (next.index - next.excluded) >
                SourceValidationPolicy.maximumRejectionRatio)
          )
            return yield* failure(
              "failed completion quality guard: " +
                next.emitted +
                " complete, " +
                next.rejected +
                " rejected, " +
                next.excluded +
                " unavailable",
            );
          if (result.status === "available") {
            yield* options.onBatch([result.vehicle]);
            count++;
          }
          cursor = terminal ? { source: "pontiac", phase: "complete" } : next;
          break;
        }
      }
      pagesProcessed++;
    }
    const checkpoint = PontiacCursorSchema.safeParse(cursor);
    if (!checkpoint.success)
      return yield* failure(
        "checkpoint exceeds bounded catalog limits or has inconsistent evidence: " +
          checkpoint.error.message,
      );
    return {
      source: "pontiac",
      status: cursor.phase === "complete" ? "complete" : "paused",
      cursor: checkpoint.data,
      count,
      pagesProcessed,
      accounting,
      observedVins: [...observedVins],
      warnings: accounting.recordsRejected
        ? [
            "Pontiac excluded incomplete donors; independently valid VINs supply presence evidence only.",
          ]
        : [],
      errors: [],
    } satisfies PontiacStreamResult;
  }).pipe(
    Effect.timeoutFail({
      duration: "3 minutes",
      onTimeout: () =>
        failure(
          "exceeded its three-minute chunk budget, retry the same cursor",
        ),
    }),
  );
}

export function streamPontiacInventory<E, R>(options: PontiacOptions<E, R>) {
  return Effect.scoped(
    RateLimiter.make({ limit: 1, interval: "1600 millis" }).pipe(
      Effect.flatMap((gate) =>
        streamPontiacInventoryWithRequestGate(options, gate),
      ),
    ),
  );
}
