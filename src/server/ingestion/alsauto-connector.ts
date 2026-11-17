import { inspectAlsautoEvidence } from "./alsauto-protocol";
import { ingestionValidation } from "./ingestion-validation";
import { Effect } from "effect";
import { readAlsautoPage, AlsautoProviderError } from "./alsauto-client";
import { AlsautoCursor } from "./alsauto-cursor";
import { alsautoSnapshot, type AlsautoVehicle } from "./alsauto-snapshot";
import { ALSAUTO_YARD, type AlsautoYard } from "./alsauto-configuration";
import type { ConnectorChunkAccounting } from "./connector-chunk";
import type { ProviderRequestGate } from "./provider-http-client";
import type { AlsautoRecord } from "./alsauto-parser";

export interface AlsautoOptions<E, R> {
  previousAcceptedCount: number | null;
  startCursor?: unknown;
  maxPages?: number;
  now?: Date;
  readPage: (url: string) => Effect.Effect<string, AlsautoProviderError>;
  onBatch: (vehicles: AlsautoVehicle[]) => Effect.Effect<void, E, R>;
  onYards?: (yards: AlsautoYard[]) => Effect.Effect<void, E, R>;
}
export interface AlsautoStreamResult {
  source: "alsauto";
  status: "paused" | "complete";
  cursor: AlsautoCursor;
  count: number;
  pagesProcessed: number;
  errors: string[];
  warnings: string[];
  observedVins: string[];
  rejections: AlsautoRecord[];
  accounting: ConnectorChunkAccounting;
}
const attempt = <A>(operation: string, run: () => A) =>
  ingestionValidation({
    try: run,
    catch: (cause) => new AlsautoProviderError(operation, cause),
  });

export function streamAlsautoInventory<E, R>(options: AlsautoOptions<E, R>) {
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
        new AlsautoProviderError(
          "run options",
          "Use 1-8 physical GETs per chunk and a nonnegative prior complete count",
        ),
      );
    let cursor = yield* attempt("checkpoint", () =>
      AlsautoCursor.parse(
        options.startCursor ??
          AlsautoCursor.initial(options.previousAcceptedCount),
        options.previousAcceptedCount,
      ),
    );
    const summary: AlsautoStreamResult = {
      source: "alsauto",
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
      const progress = yield* attempt("evidence prefix", () =>
        inspectAlsautoEvidence(cursor.evidence),
      );
      if (progress.kind === "ready") {
        const ready = cursor;
        const snapshot = yield* attempt("complete report quality", () => {
          const value = alsautoSnapshot(
            progress.records,
            options.previousAcceptedCount,
            options.now,
          );
          if (value.errors.length) throw new Error(value.errors.join("; "));
          return value;
        });
        // No canonical callback, observed identity or accounting is released
        // until all actual native controls and whole-source guards pass.
        if (options.onYards) yield* options.onYards([{ ...ALSAUTO_YARD }]);
        yield* options.onBatch(snapshot.vehicles);
        summary.count = snapshot.vehicles.length;
        summary.accounting = snapshot.accounting;
        summary.observedVins = snapshot.observedVins;
        summary.rejections = snapshot.rejected;
        if (snapshot.rejected.length)
          summary.warnings.push(
            `Al's Auto Salvage retains ${snapshot.rejected.length} required-field rejects; valid rejected/conflicting identities protect existing records during reconciliation.`,
          );
        cursor = AlsautoCursor.complete(ready);
      } else {
        if (summary.pagesProcessed >= budget) break;
        const current = cursor;
        const url = yield* attempt("next native control", () => progress.url);
        const raw = yield* options.readPage(url);
        cursor = yield* attempt("native opening/closing " + url, () =>
          AlsautoCursor.advance(current, raw),
        );
        summary.pagesProcessed++;
      }
    }
    return {
      ...summary,
      cursor,
      status: cursor.phase === "complete" ? "complete" : "paused",
    } satisfies AlsautoStreamResult;
  }).pipe(
    Effect.timeoutFail({
      duration: "3 minutes",
      onTimeout: () =>
        new AlsautoProviderError(
          "chunk deadline",
          "Three-minute deadline exceeded; retain the last validated checkpoint",
        ),
    }),
  );
}
export function streamAlsautoInventoryWithRequestGate<E, R>(
  options: Omit<AlsautoOptions<E, R>, "readPage">,
  gate: ProviderRequestGate,
) {
  return streamAlsautoInventory({
    ...options,
    readPage: (url) => readAlsautoPage(url, gate),
  });
}
export function streamAlsautoInventoryFromProvider<E, R>(
  options: Omit<AlsautoOptions<E, R>, "readPage">,
) {
  return streamAlsautoInventory({
    ...options,
    readPage: readAlsautoPage,
  });
}
