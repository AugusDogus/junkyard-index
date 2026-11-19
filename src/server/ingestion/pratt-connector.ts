import { Effect, Option } from "effect";
import type { ConnectorChunkAccounting } from "./connector-chunk";
import { PrattContract, type PrattYard } from "./pratt-contract";
import {
  PrattCursor,
  PRATT_MAX_REQUESTS,
  PRATT_MAX_TOTAL_BYTES,
} from "./pratt-cursor";
import { PRATT_MAX_BODY_BYTES, readPrattPage } from "./pratt-client";
import { prattNextUrl, prattAdvance } from "./pratt-traversal";
import { PrattResult, type PrattError } from "./pratt-result";
import { prattSnapshot, validatePrattSnapshot } from "./pratt-snapshot";
import type { PrattCanonicalVehicle } from "./pratt-transform";
import { ProviderChunkClock } from "./provider-chunk-clock";
import { sharedProviderHostTurn } from "./shared-provider-host";

export interface PrattOptions<E, R> {
  contract: PrattContract;
  previousUniqueInventory: number | null;
  startCursor?: unknown;
  maxPages?: number;
  /** Inject a complete bounded owned HTTP200 document, or a saved test fixture.
   * Supplying a reader keeps pure saved replay independent from live transport. */
  readPage: (url: string) => Effect.Effect<string, PrattError>;
  onBatch: (vehicles: PrattCanonicalVehicle[]) => Effect.Effect<void, E, R>;
  onYards?: (yards: PrattYard[]) => Effect.Effect<void, E, R>;
}
export interface PrattStreamResult {
  source: "pratt";
  status: "paused" | "complete";
  cursor: PrattCursor;
  count: number;
  pagesProcessed: number;
  errors: string[];
  warnings: string[];
  observedVins: string[];
  accounting: ConnectorChunkAccounting;
}
const unwrap = <T>(result: import("./pratt-result").PrattResult<T>) =>
  result.ok ? Effect.succeed(result.value) : Effect.fail(result.error);

export function streamPrattInventory<E, R>(options: PrattOptions<E, R>) {
  return Effect.gen(function* () {
    const contract = yield* unwrap(PrattContract.parse(options.contract));
    const budget = options.maxPages ?? 8;
    if (
      !Number.isSafeInteger(budget) ||
      budget < 1 ||
      budget > 8 ||
      (options.previousUniqueInventory !== null &&
        (!Number.isSafeInteger(options.previousUniqueInventory) ||
          options.previousUniqueInventory < 0))
    )
      return yield* Effect.fail(
        PrattResult.error(
          "run options",
          "Use a request budget from 1 to 8 and a nonnegative previous complete inventory count",
        ),
      );
    let cursor = yield* unwrap(
      PrattCursor.parse(
        options.startCursor ?? PrattCursor.initial(contract),
        contract,
      ),
    );
    const summary: PrattStreamResult = {
      source: "pratt",
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
        const snapshot = prattSnapshot(
          cursor.pages,
          cursor.arrivals,
          cursor.menus,
          contract,
        );
        yield* unwrap(
          validatePrattSnapshot(
            snapshot,
            contract,
            options.previousUniqueInventory,
          ),
        );
        if (options.onYards) yield* options.onYards([{ ...contract.yard }]);
        yield* options.onBatch(snapshot.vehicles);
        summary.count = snapshot.vehicles.length;
        summary.accounting = snapshot.accounting;
        summary.observedVins = snapshot.observedVins;
        summary.warnings = [
          "Pratt retained native required rejects and quarantined connected conflicting VIN/destination observations; badge differences are diagnostic and optional metadata is nullable.",
        ];
        cursor = yield* unwrap(
          PrattCursor.checkpoint(
            {
              source: "pratt",
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
          cursor.requests >= PRATT_MAX_REQUESTS ||
          cursor.bytes > PRATT_MAX_TOTAL_BYTES - PRATT_MAX_BODY_BYTES
        )
          return yield* Effect.fail(
            PrattResult.error(
              "whole-run budget",
              "Native graph is incomplete and the run reached 1024 requests or has less than the 2 MiB maximum document allowance remaining within 128 MiB; retain the last validated checkpoint",
            ),
          );
        const url = yield* unwrap(prattNextUrl(cursor));
        const page = yield* options
          .readPage(url)
          .pipe(
            sharedProviderHostTurn(url),
            ProviderChunkClock.unlessDeferred(summary.pagesProcessed > 0),
          );
        if (Option.isNone(page)) break;
        const raw = page.value;
        cursor = yield* unwrap(prattAdvance(cursor, raw, contract));
        summary.pagesProcessed++;
      }
    }
    return {
      ...summary,
      cursor,
      status: cursor.phase === "complete" ? "complete" : "paused",
    } satisfies PrattStreamResult;
  }).pipe(
    ProviderChunkClock.deadline({
      duration: "3 minutes",
      onTimeout: () =>
        PrattResult.error(
          "chunk deadline",
          "Three-minute limit exceeded; retain the last validated checkpoint",
        ),
    }),
  );
}

/** Live-capable driver. Calling this API performs HTTP; registration and
 * qualification remain caller-owned. Tests use the injected reader above. */
export function streamPrattInventoryFromProvider<E, R>(
  options: Omit<PrattOptions<E, R>, "readPage">,
) {
  return streamPrattInventory({ ...options, readPage: readPrattPage });
}
