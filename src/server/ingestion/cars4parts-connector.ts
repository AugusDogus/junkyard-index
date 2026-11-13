import { Effect } from "effect";
import type { ConnectorChunkAccounting } from "./connector-chunk";
import { readCars4PartsPage } from "./cars4parts-client";
import { Cars4PartsContract, type Cars4PartsYard } from "./cars4parts-contract";
import {
  Cars4PartsCursor,
  CARS4PARTS_MAX_REQUESTS,
  CARS4PARTS_MAX_TOTAL_BYTES,
} from "./cars4parts-cursor";
import { CARS4PARTS_MAX_BODY_BYTES } from "./cars4parts-html";
import {
  Cars4PartsResult,
  type Cars4PartsError,
  type Cars4PartsResult as Result,
} from "./cars4parts-result";
import {
  cars4partsSnapshot,
  Cars4PartsPreviousInventorySchema,
  validateCars4PartsSnapshot,
  type Cars4PartsPreviousInventory,
} from "./cars4parts-snapshot";
import { cars4partsAdvance, cars4partsNextUrl } from "./cars4parts-traversal";
import type { Cars4PartsCanonicalVehicle } from "./cars4parts-transform";

export interface Cars4PartsOptions<E, R> {
  contract: Cars4PartsContract;
  previousUniqueInventory: Cars4PartsPreviousInventory;
  startCursor?: unknown;
  maxPages?: number;
  readPage: (url: string) => Effect.Effect<string, Cars4PartsError>;
  onBatch: (
    vehicles: Cars4PartsCanonicalVehicle[],
  ) => Effect.Effect<void, E, R>;
  onYards?: (yards: Cars4PartsYard[]) => Effect.Effect<void, E, R>;
}
export interface Cars4PartsStreamResult {
  source: "cars4parts";
  status: "paused" | "complete";
  cursor: Cars4PartsCursor;
  count: number;
  pagesProcessed: number;
  errors: string[];
  warnings: string[];
  observedVins: string[];
  accounting: ConnectorChunkAccounting;
}
const unwrap = <T>(result: Result<T>) =>
  result.ok ? Effect.succeed(result.value) : Effect.fail(result.error);
export function streamCars4PartsInventory<E, R>(
  options: Cars4PartsOptions<E, R>,
) {
  return Effect.gen(function* () {
    const contract = yield* unwrap(Cars4PartsContract.parse(options.contract));
    const previous = yield* unwrap(
      Cars4PartsResult.boundary("previous complete yard counts", () =>
        Cars4PartsPreviousInventorySchema.parse(
          options.previousUniqueInventory,
        ),
      ),
    );
    const budget = options.maxPages ?? 8;
    if (!Number.isSafeInteger(budget) || budget < 1 || budget > 8)
      return yield* Effect.fail(
        Cars4PartsResult.error(
          "run options",
          "Use 1 to 8 native requests per chunk and nonnegative previous complete per-yard counts",
        ),
      );
    let cursor = yield* unwrap(
      Cars4PartsCursor.parse(
        options.startCursor ?? Cars4PartsCursor.initial(contract),
        contract,
      ),
    );
    const summary: Cars4PartsStreamResult = {
      source: "cars4parts",
      cursor,
      status: "paused",
      count: 0,
      pagesProcessed: 0,
      errors: [],
      warnings: [],
      observedVins: [],
      accounting: {
        recordsProcessed: 0,
        recordsRejected: 0,
        recordsExcluded: 0,
        duplicateVehicles: 0,
      },
    };
    while (cursor.phase !== "complete") {
      if (cursor.phase === "ready") {
        const ready = cursor;
        const snapshot = yield* unwrap(
          Cars4PartsResult.boundary("native snapshot", () =>
            cars4partsSnapshot(
              ready.pages,
              ready.records,
              ready.makes,
              contract,
            ),
          ),
        );
        yield* unwrap(validateCars4PartsSnapshot(snapshot, contract, previous));
        if (options.onYards)
          yield* options.onYards([
            { ...contract.heyworth.yard },
            { ...contract.armington.yard },
          ]);
        yield* options.onBatch(snapshot.vehicles);
        summary.count = snapshot.vehicles.length;
        summary.observedVins = snapshot.observedVins;
        summary.accounting = snapshot.accounting;
        summary.warnings = [
          "Cars4Parts retains explicit required-field and unresolved-scope rejects with valid VIN presence; retail offers are separately excluded and conflicting optional metadata is null.",
        ];
        cursor = yield* unwrap(
          Cars4PartsCursor.checkpoint(
            {
              source: cursor.source,
              version: cursor.version,
              scope: cursor.scope,
              requests: cursor.requests,
              bytes: cursor.bytes,
              phase: "complete",
            },
            contract,
          ),
        );
      } else {
        if (summary.pagesProcessed >= budget) break;
        if (
          cursor.requests >= CARS4PARTS_MAX_REQUESTS ||
          cursor.bytes > CARS4PARTS_MAX_TOTAL_BYTES - CARS4PARTS_MAX_BODY_BYTES
        )
          return yield* Effect.fail(
            Cars4PartsResult.error(
              "whole-run budget",
              "Native graph is incomplete and reached 1024 requests or has less than the 2 MiB maximum next response allowance within 128 MiB; retain the last validated checkpoint",
            ),
          );
        const url = yield* unwrap(cars4partsNextUrl(cursor));
        const raw = yield* options.readPage(url);
        cursor = yield* unwrap(cars4partsAdvance(cursor, raw, contract));
        summary.pagesProcessed++;
      }
    }
    return {
      ...summary,
      cursor,
      status: cursor.phase === "complete" ? "complete" : "paused",
    } satisfies Cars4PartsStreamResult;
  }).pipe(
    Effect.timeoutFail({
      duration: "3 minutes",
      onTimeout: () =>
        Cars4PartsResult.error(
          "chunk deadline",
          "Three-minute limit exceeded; retain the last validated checkpoint",
        ),
    }),
  );
}
/** Live-capable only when explicitly called by registered ingestion wiring. */
export function streamCars4PartsInventoryFromProvider<E, R>(
  options: Omit<Cars4PartsOptions<E, R>, "readPage">,
) {
  return streamCars4PartsInventory({
    ...options,
    readPage: readCars4PartsPage,
  });
}
