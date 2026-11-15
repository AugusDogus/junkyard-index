import { Effect } from "effect";
import type { ConnectorChunkAccounting } from "./connector-chunk";
import { AlliedContract, type AlliedYard } from "./allied-contract";
import {
  AlliedCursor,
  ALLIED_MAX_REQUESTS,
  ALLIED_MAX_TOTAL_BYTES,
} from "./allied-cursor";
import { ALLIED_MAX_BODY_BYTES, readAlliedPage } from "./allied-client";
import {
  alliedCountWarnings,
  alliedNextUrl,
  alliedAdvance,
} from "./allied-traversal";
import { AlliedResult, type AlliedError } from "./allied-result";
import { alliedSnapshot, validateAlliedSnapshot } from "./allied-snapshot";
import type { AlliedCanonicalVehicle } from "./allied-transform";

export interface AlliedOptions<E, R> {
  contract: AlliedContract;
  previousUniqueInventory: number | null;
  startCursor?: unknown;
  maxPages?: number;
  /** Inject a complete bounded owned HTTP200 document, or a saved test fixture.
   * Supplying a reader keeps pure saved replay independent from live transport. */
  readPage: (url: string) => Effect.Effect<string, AlliedError>;
  onBatch: (vehicles: AlliedCanonicalVehicle[]) => Effect.Effect<void, E, R>;
  onYards?: (yards: AlliedYard[]) => Effect.Effect<void, E, R>;
}
export interface AlliedStreamResult {
  source: "allied";
  status: "paused" | "complete";
  cursor: AlliedCursor;
  count: number;
  pagesProcessed: number;
  errors: string[];
  warnings: string[];
  observedVins: string[];
  accounting: ConnectorChunkAccounting;
}
const unwrap = <T>(result: import("./allied-result").AlliedResult<T>) =>
  result.ok ? Effect.succeed(result.value) : Effect.fail(result.error);

export function streamAlliedInventory<E, R>(options: AlliedOptions<E, R>) {
  return Effect.gen(function* () {
    const contract = yield* unwrap(AlliedContract.parse(options.contract));
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
        AlliedResult.error(
          "run options",
          "Use a request budget from 1 to 4 and a nonnegative previous complete inventory count",
        ),
      );
    let cursor = yield* unwrap(
      AlliedCursor.parse(
        options.startCursor ?? AlliedCursor.initial(contract),
        contract,
      ),
    );
    const summary: AlliedStreamResult = {
      source: "allied",
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
        const snapshot = alliedSnapshot(
          cursor.pages,
          cursor.arrivals,
          cursor.menus,
          contract,
        );
        yield* unwrap(
          validateAlliedSnapshot(
            snapshot,
            contract,
            options.previousUniqueInventory,
          ),
        );
        if (options.onYards) yield* options.onYards([{ ...contract.yard }]);
        yield* options.onBatch(
          snapshot.vehicles.map((vehicle) => ({ ...vehicle })),
        );
        summary.count = snapshot.vehicles.length;
        summary.accounting = snapshot.accounting;
        summary.observedVins = snapshot.observedVins;
        summary.warnings = [
          `Allied skipped ${snapshot.accounting.recordsExcluded} records with nonstandard stock codes, outside the rejection denominator. ${snapshot.accounting.recordsRejected} normal-stock observations were rejected.`,
          ...alliedCountWarnings(cursor),
        ];
        cursor = yield* unwrap(
          AlliedCursor.checkpoint(
            {
              source: "allied",
              version: 1,
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
          cursor.requests >= ALLIED_MAX_REQUESTS ||
          cursor.bytes > ALLIED_MAX_TOTAL_BYTES - ALLIED_MAX_BODY_BYTES
        )
          return yield* Effect.fail(
            AlliedResult.error(
              "whole-run budget",
              "Native graph is incomplete and the run reached 1024 requests or has less than the 2 MiB maximum document allowance remaining within 128 MiB; retain the last validated checkpoint",
            ),
          );
        const url = yield* unwrap(alliedNextUrl(cursor));
        const raw = yield* options.readPage(url);
        cursor = yield* unwrap(alliedAdvance(cursor, raw, contract));
        summary.pagesProcessed++;
      }
    }
    return {
      ...summary,
      cursor,
      status: cursor.phase === "complete" ? "complete" : "paused",
    } satisfies AlliedStreamResult;
  }).pipe(
    Effect.timeoutFail({
      duration: "4 minutes",
      onTimeout: () =>
        AlliedResult.error(
          "chunk deadline",
          "Four-minute limit exceeded; retain the last validated checkpoint",
        ),
    }),
  );
}

/** Live-capable driver. Calling this API performs HTTP; registration and
 * qualification remain caller-owned. Tests use the injected reader above. */
export function streamAlliedInventoryFromProvider<E, R>(
  options: Omit<AlliedOptions<E, R>, "readPage">,
) {
  return streamAlliedInventory({ ...options, readPage: readAlliedPage });
}
