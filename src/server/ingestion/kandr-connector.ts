import { Effect } from "effect";
import type { ConnectorChunkAccounting } from "./connector-chunk";
import {
  KandrContract,
  KandrError,
  kandrBoundary,
  type KandrResult,
} from "./kandr-contract";
import {
  KandrCursor,
  KANDR_MAX_REQUESTS,
  KANDR_MAX_TOTAL_BYTES,
} from "./kandr-cursor";
import { KANDR_MAX_BODY_BYTES } from "./kandr-native";
import { KandrSnapshot, type KandrVehicle } from "./kandr-snapshot";
import { readKandrPage } from "./kandr-client";

export interface KandrOptions<E, R> {
  contract: KandrContract;
  previousUniqueInventory: number | null;
  startCursor?: unknown;
  maxPages?: number;
  readPage: (url: string) => Effect.Effect<string, KandrError>;
  onBatch: (vehicles: KandrVehicle[]) => Effect.Effect<void, E, R>;
}
export interface KandrStreamResult {
  source: "kandr";
  status: "paused" | "complete";
  cursor: KandrCursor;
  count: number;
  pagesProcessed: number;
  errors: string[];
  warnings: string[];
  observedVins: string[];
  accounting: ConnectorChunkAccounting;
}
const unwrap = <T>(result: KandrResult<T>): Effect.Effect<T, KandrError> =>
  result.ok ? Effect.succeed(result.value) : Effect.fail(result.error);

export function streamKandrInventory<E, R>(options: KandrOptions<E, R>) {
  return Effect.gen(function* () {
    const contract = yield* unwrap(KandrContract.parse(options.contract));
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
        KandrError.create(
          "run options",
          "Use 1 to 8 GETs per chunk and a nonnegative previous complete inventory count",
        ),
      );
    let cursor = yield* unwrap(
      options.startCursor === undefined
        ? KandrCursor.initial(contract)
        : typeof options.startCursor === "string"
          ? KandrCursor.fromWire(options.startCursor, contract)
          : KandrCursor.parse(options.startCursor, contract),
    );
    const summary: KandrStreamResult = {
      source: "kandr",
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
      const edge = KandrCursor.next(cursor);
      if (edge.kind === "ready") {
        const graph = yield* unwrap(KandrCursor.snapshotGraph(cursor));
        const snapshot = yield* unwrap(
          kandrBoundary("complete-source quality", () => {
            const snapshot = KandrSnapshot.create(graph.pages, graph.details);
            KandrSnapshot.validate(
              snapshot,
              contract.minimumUniqueInventory,
              options.previousUniqueInventory,
            );
            return snapshot;
          }),
        );
        const complete = yield* unwrap(KandrCursor.complete(cursor, contract));
        // Publish terminal evidence only after the one closed, validated batch succeeds.
        yield* options.onBatch(snapshot.vehicles);
        cursor = complete;
        summary.count = snapshot.vehicles.length;
        summary.accounting = snapshot.accounting;
        summary.observedVins = snapshot.observedVins;
        summary.warnings = snapshot.rejects.length
          ? [
              "K&R retains native required/scope rejects and protects their valid VINs during reconciliation.",
            ]
          : [];
      } else {
        if (summary.pagesProcessed >= budget) break;
        if (
          cursor.requests >= KANDR_MAX_REQUESTS ||
          cursor.bytes > KANDR_MAX_TOTAL_BYTES - KANDR_MAX_BODY_BYTES
        )
          return yield* Effect.fail(
            KandrError.create(
              "whole-run budget",
              "The native graph is incomplete at the request or byte limit",
            ),
          );
        const raw = yield* options.readPage(edge.url);
        cursor = yield* unwrap(KandrCursor.advance(cursor, raw, contract));
        summary.pagesProcessed++;
      }
    }
    return {
      ...summary,
      cursor,
      status: cursor.phase === "complete" ? "complete" : "paused",
    } satisfies KandrStreamResult;
  }).pipe(
    Effect.timeoutFail({
      duration: "4 minutes",
      onTimeout: () =>
        KandrError.create(
          "chunk deadline",
          "Four-minute chunk deadline exceeded; retain the last validated checkpoint",
        ),
    }),
  );
}

/** Explicit live entry point only. This leaf does not register or enable K&R. */
export function streamKandrInventoryFromProvider<E, R>(
  options: Omit<KandrOptions<E, R>, "readPage">,
) {
  return streamKandrInventory({ ...options, readPage: readKandrPage });
}
