import { Effect } from "effect";
import type { ConnectorChunkAccounting } from "./connector-chunk";
import {
  CaltonContract,
  CaltonError,
  type CaltonCanonicalVehicle,
} from "./calton-contract";
import {
  CaltonCursor,
  CALTON_MAX_REQUESTS,
  CALTON_MAX_TOTAL_BYTES,
} from "./calton-cursor";
import { CALTON_MAX_BODY_BYTES, readCaltonPage } from "./calton-client";
import { caltonAdvance, caltonNextUrl } from "./calton-traversal";
import { CaltonSnapshot } from "./calton-snapshot";

export interface CaltonOptions<E, R> {
  contract: CaltonContract;
  previousUniqueInventory: number | null;
  startCursor?: unknown;
  maxPages?: number;
  /** Complete bounded HTTP 200 documents, or saved fixtures. No retry here. */
  readPage: (url: string) => Effect.Effect<string, CaltonError>;
  onBatch: (vehicles: CaltonCanonicalVehicle[]) => Effect.Effect<void, E, R>;
}
export interface CaltonStreamResult {
  source: "calton";
  status: "paused" | "complete";
  cursor: CaltonCursor;
  count: number;
  pagesProcessed: number;
  errors: string[];
  warnings: string[];
  observedVins: string[];
  accounting: ConnectorChunkAccounting;
}
const unwrap = <T, E>(
  result: { ok: true; value: T } | { ok: false; error: E },
): Effect.Effect<T, E> =>
  result.ok ? Effect.succeed(result.value) : Effect.fail(result.error);

export function streamCaltonInventory<E, R>(options: CaltonOptions<E, R>) {
  return Effect.gen(function* () {
    const contract = yield* unwrap(CaltonContract.parse(options.contract));
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
        CaltonError.create(
          "run options",
          "Use a chunk budget from 1 to 8 requests and a nonnegative previous complete inventory count",
        ),
      );
    const initial =
      options.startCursor === undefined
        ? CaltonCursor.initial(contract)
        : typeof options.startCursor === "string"
          ? CaltonCursor.fromWire(options.startCursor, contract)
          : CaltonCursor.parse(options.startCursor, contract);
    let cursor = yield* unwrap(initial);
    const summary: CaltonStreamResult = {
      source: "calton",
      status: "paused",
      cursor,
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
        const snapshot = CaltonSnapshot.create(
          [cursor.arrivals, ...cursor.pages],
          cursor.makes.controls.map((make) => make.label),
          contract.location,
        );
        yield* unwrap(
          CaltonSnapshot.validate(snapshot, {
            minimumUniqueInventory: contract.minimumUniqueInventory,
            previousUniqueInventory: options.previousUniqueInventory,
          }),
        );
        // Construct the terminal checkpoint before callbacks, but publish it only
        // after the caller accepts the one complete validated batch.
        const complete = yield* unwrap(
          CaltonCursor.checkpoint(
            {
              source: "calton",
              version: 1,
              scope: cursor.scope,
              requests: cursor.requests,
              bytes: cursor.bytes,
              phase: "complete",
            },
            contract,
          ),
        );
        yield* options.onBatch(snapshot.vehicles);
        summary.count = snapshot.vehicles.length;
        summary.accounting = snapshot.accounting;
        summary.observedVins = snapshot.observedVins;
        summary.warnings = [
          "Calton retained native required rejects and global identity conflicts. Menu count differences are diagnostic; optional metadata remains nullable.",
        ];
        cursor = complete;
      } else {
        if (summary.pagesProcessed >= budget) break;
        if (
          cursor.requests >= CALTON_MAX_REQUESTS ||
          cursor.bytes > CALTON_MAX_TOTAL_BYTES - CALTON_MAX_BODY_BYTES
        )
          return yield* Effect.fail(
            CaltonError.create(
              "whole-run budget",
              "Native graph is incomplete at the bounded request or byte limit",
            ),
          );
        const url = yield* unwrap(caltonNextUrl(cursor));
        const raw = yield* options.readPage(url);
        cursor = yield* unwrap(caltonAdvance(cursor, raw, contract));
        summary.pagesProcessed++;
      }
    }
    return {
      ...summary,
      cursor,
      status: cursor.phase === "complete" ? "complete" : "paused",
    } satisfies CaltonStreamResult;
  }).pipe(
    Effect.timeoutFail({
      duration: "3 minutes",
      onTimeout: () =>
        CaltonError.create(
          "chunk deadline",
          "Three-minute chunk deadline exceeded; retain the last validated checkpoint",
        ),
    }),
  );
}
/** Live-capable only when explicitly called; this does not register the source. */
export function streamCaltonInventoryFromProvider<E, R>(
  options: Omit<CaltonOptions<E, R>, "readPage">,
) {
  return streamCaltonInventory({ ...options, readPage: readCaltonPage });
}
