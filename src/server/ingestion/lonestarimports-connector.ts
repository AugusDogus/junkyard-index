import { ingestionValidation } from "./ingestion-validation";
import { Effect } from "effect";
import {
  readLonestarimportsPage,
  LonestarimportsProviderError,
} from "./lonestarimports-client";
import {
  LonestarimportsCursor,
  lonestarimportsAdvance,
  lonestarimportsNextUrl,
} from "./lonestarimports-cursor";
import {
  lonestarimportsSnapshot,
  type LonestarimportsVehicle,
} from "./lonestarimports-snapshot";
import {
  LONESTARIMPORTS_YARD,
  type LonestarimportsYard,
} from "./lonestarimports-yard-metadata";
import type { ConnectorChunkAccounting } from "./connector-chunk";
import type { ProviderRequestGate } from "./provider-http-client";
import type { LonestarimportsRecord } from "./lonestarimports-parser";

export interface LonestarimportsOptions<E, R> {
  previousAcceptedCount: number | null;
  startCursor?: unknown;
  maxPages?: number;
  readPage: (
    url: string,
  ) => Effect.Effect<string, LonestarimportsProviderError>;
  onBatch: (vehicles: LonestarimportsVehicle[]) => Effect.Effect<void, E, R>;
  onYards?: (yards: LonestarimportsYard[]) => Effect.Effect<void, E, R>;
}
export interface LonestarimportsStreamResult {
  source: "lonestarimports";
  status: "paused" | "complete";
  cursor: LonestarimportsCursor;
  count: number;
  pagesProcessed: number;
  errors: string[];
  warnings: string[];
  observedVins: string[];
  rejections: LonestarimportsRecord[];
  accounting: ConnectorChunkAccounting;
}
const attempt = <A>(operation: string, run: () => A) =>
  ingestionValidation({
    try: run,
    catch: (cause) => new LonestarimportsProviderError(operation, cause),
  });

export function streamLonestarimportsInventory<E, R>(
  options: LonestarimportsOptions<E, R>,
) {
  return Effect.gen(function* () {
    const budget = options.maxPages ?? 8;
    if (
      !Number.isSafeInteger(budget) ||
      budget < 1 ||
      budget > 8 ||
      (options.previousAcceptedCount !== null &&
        (!Number.isSafeInteger(options.previousAcceptedCount) ||
          options.previousAcceptedCount < 0))
    )
      return yield* Effect.fail(
        new LonestarimportsProviderError(
          "run options",
          "Use1-8 physical GETs per chunk and a nonnegative prior complete count",
        ),
      );
    let cursor = yield* attempt("checkpoint", () =>
      LonestarimportsCursor.parse(
        options.startCursor ??
          LonestarimportsCursor.initial(options.previousAcceptedCount),
        options.previousAcceptedCount,
      ),
    );
    const summary: LonestarimportsStreamResult = {
      source: "lonestarimports",
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
          const value = lonestarimportsSnapshot(
            ready.pages.flatMap((page) => page.data),
            options.previousAcceptedCount,
          );
          if (value.errors.length) throw new Error(value.errors.join("; "));
          return value;
        });
        // No canonical callback, observed identity or accounting is released
        // until all complete native opening/closing controls and whole-source guards pass.
        if (options.onYards)
          yield* options.onYards([{ ...LONESTARIMPORTS_YARD }]);
        yield* options.onBatch(snapshot.vehicles);
        summary.count = snapshot.vehicles.length;
        summary.accounting = snapshot.accounting;
        summary.observedVins = snapshot.observedVins;
        summary.rejections = snapshot.rejected;
        if (snapshot.rejected.length)
          summary.warnings.push(
            `Lonestar Imports retains ${snapshot.rejected.length} required-field rejects; valid rejected/conflicting identities protect existing records during reconciliation.`,
          );
        cursor = LonestarimportsCursor.complete(ready);
      } else {
        if (summary.pagesProcessed >= budget) break;
        const current = cursor;
        const url = yield* attempt("next native control", () =>
          lonestarimportsNextUrl(current),
        );
        const raw = yield* options.readPage(url);
        cursor = yield* attempt("native opening/closing " + url, () =>
          lonestarimportsAdvance(current, raw),
        );
        summary.pagesProcessed++;
      }
    }
    return {
      ...summary,
      cursor,
      status: cursor.phase === "complete" ? "complete" : "paused",
    } satisfies LonestarimportsStreamResult;
  }).pipe(
    Effect.timeoutFail({
      duration: "4 minutes",
      onTimeout: () =>
        new LonestarimportsProviderError(
          "chunk deadline",
          "Four-minute deadline exceeded; retain the last validated checkpoint",
        ),
    }),
  );
}
export function streamLonestarimportsInventoryWithRequestGate<E, R>(
  options: Omit<LonestarimportsOptions<E, R>, "readPage">,
  gate: ProviderRequestGate,
) {
  return streamLonestarimportsInventory({
    ...options,
    readPage: (url) => readLonestarimportsPage(url, gate),
  });
}
export function streamLonestarimportsInventoryFromProvider<E, R>(
  options: Omit<LonestarimportsOptions<E, R>, "readPage">,
) {
  return streamLonestarimportsInventory({
    ...options,
    readPage: readLonestarimportsPage,
  });
}
