import { Effect } from "effect";
import {
  readChasencarsPage,
  ChasencarsProviderError,
} from "./chasencars-client";
import {
  ChasencarsCursor,
  chasencarsAdvance,
  chasencarsNextUrl,
} from "./chasencars-cursor";
import {
  chasencarsSnapshot,
  type ChasencarsVehicle,
} from "./chasencars-snapshot";
import {
  CHASENCARS_YARD,
  type ChasencarsYard,
} from "./chasencars-yard-metadata";
import type { ConnectorChunkAccounting } from "./connector-chunk";
import type { ProviderRequestGate } from "./provider-http-client";
import type { ChasencarsRecord } from "./chasencars-parser";

export interface ChasencarsOptions<E, R> {
  previousAcceptedCount: number | null;
  startCursor?: unknown;
  maxPages?: number;
  readPage: (url: string) => Effect.Effect<string, ChasencarsProviderError>;
  onBatch: (vehicles: ChasencarsVehicle[]) => Effect.Effect<void, E, R>;
  onYards?: (yards: ChasencarsYard[]) => Effect.Effect<void, E, R>;
}
export interface ChasencarsStreamResult {
  source: "chasencars";
  status: "paused" | "complete";
  cursor: ChasencarsCursor;
  count: number;
  pagesProcessed: number;
  errors: string[];
  warnings: string[];
  observedVins: string[];
  rejections: ChasencarsRecord[];
  accounting: ConnectorChunkAccounting;
}
const attempt = <A>(operation: string, run: () => A) =>
  Effect.try({
    try: run,
    catch: (cause) => new ChasencarsProviderError(operation, cause),
  });

export function streamChasencarsInventory<E, R>(
  options: ChasencarsOptions<E, R>,
) {
  return Effect.gen(function* () {
    const budget = options.maxPages ?? 6;
    if (
      !Number.isSafeInteger(budget) ||
      budget < 1 ||
      budget > 8 ||
      (options.previousAcceptedCount !== null &&
        (!Number.isSafeInteger(options.previousAcceptedCount) ||
          options.previousAcceptedCount < 0))
    )
      return yield* Effect.fail(
        new ChasencarsProviderError(
          "run options",
          "Use1-8 physical GETs per chunk and a nonnegative prior complete count",
        ),
      );
    let cursor = yield* attempt("checkpoint", () =>
      ChasencarsCursor.parse(
        options.startCursor ??
          ChasencarsCursor.initial(options.previousAcceptedCount),
        options.previousAcceptedCount,
      ),
    );
    const summary: ChasencarsStreamResult = {
      source: "chasencars",
      status: "paused",
      cursor,
      count: 0,
      pagesProcessed: 0,
      errors: [],
      warnings: [],
      observedVins: [],
      rejections: [],
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
        const snapshot = yield* attempt("complete report quality", () => {
          const value = chasencarsSnapshot(
            ready.catalog,
            options.previousAcceptedCount,
          );
          if (value.errors.length) throw new Error(value.errors.join("; "));
          return value;
        });
        // No canonical callback, observed identity or accounting is released
        // until all six actual native controls and whole-source guards pass.
        if (options.onYards) yield* options.onYards([{ ...CHASENCARS_YARD }]);
        yield* options.onBatch(snapshot.vehicles);
        summary.count = snapshot.vehicles.length;
        summary.accounting = snapshot.accounting;
        summary.observedVins = snapshot.observedVins;
        summary.rejections = snapshot.rejected;
        if (snapshot.rejected.length)
          summary.warnings.push(
            `Chase N Cars retains ${snapshot.rejected.length} required-field rejects; valid rejected/conflicting identities protect existing records during reconciliation.`,
          );
        cursor = ChasencarsCursor.complete(ready);
      } else {
        if (summary.pagesProcessed >= budget) break;
        const current = cursor;
        const url = yield* attempt("next native control", () =>
          chasencarsNextUrl(current),
        );
        const raw = yield* options.readPage(url);
        cursor = yield* attempt("native opening/closing " + url, () =>
          chasencarsAdvance(current, raw),
        );
        summary.pagesProcessed++;
      }
    }
    return {
      ...summary,
      cursor,
      status: cursor.phase === "complete" ? "complete" : "paused",
    } satisfies ChasencarsStreamResult;
  }).pipe(
    Effect.timeoutFail({
      duration: "3 minutes",
      onTimeout: () =>
        new ChasencarsProviderError(
          "chunk deadline",
          "Three-minute deadline exceeded; retain the last validated checkpoint",
        ),
    }),
  );
}
export function streamChasencarsInventoryWithRequestGate<E, R>(
  options: Omit<ChasencarsOptions<E, R>, "readPage">,
  gate: ProviderRequestGate,
) {
  return streamChasencarsInventory({
    ...options,
    readPage: (url) => readChasencarsPage(url, gate),
  });
}
export function streamChasencarsInventoryFromProvider<E, R>(
  options: Omit<ChasencarsOptions<E, R>, "readPage">,
) {
  return streamChasencarsInventory({
    ...options,
    readPage: readChasencarsPage,
  });
}
