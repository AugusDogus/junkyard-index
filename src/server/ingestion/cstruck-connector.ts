import { Effect } from "effect";
import type { ConnectorChunkAccounting } from "./connector-chunk";
import type { ProviderRequestGate } from "./provider-http-client";
import {
  CstruckProviderError,
  cstruckValidated,
  fetchCstruckPage,
} from "./cstruck-client";
import {
  CstruckCursor,
  cstruckAdvance,
  cstruckNextUrl,
  cstruckRoster,
} from "./cstruck-cursor";
import { cstruckSnapshot, type CstruckVehicle } from "./cstruck-snapshot";
import { CSTRUCK_YARD } from "./cstruck-yard-metadata";

export interface CstruckStreamResult {
  source: "cstruck";
  status: "complete" | "paused";
  cursor: CstruckCursor;
  count: number;
  pagesProcessed: number;
  accounting: ConnectorChunkAccounting;
  observedVins: string[];
  errors: string[];
  warnings: string[];
}
interface Options<E, R> {
  startCursor?: CstruckCursor;
  previousAcceptedCount: number | null;
  maxPages?: number;
  onBatch: (vehicles: CstruckVehicle[]) => Effect.Effect<void, E, R>;
  onYards?: (yards: (typeof CSTRUCK_YARD)[]) => Effect.Effect<void, E, R>;
  readPage?: (url: string) => Effect.Effect<string, CstruckProviderError>;
}
export function streamCstruckInventory<E, R>(
  options: Options<E, R>,
  gate?: ProviderRequestGate,
): Effect.Effect<CstruckStreamResult, CstruckProviderError | E, R> {
  return Effect.gen(function* () {
    const budget = options.maxPages ?? 8;
    if (!Number.isSafeInteger(budget) || budget < 1 || budget > 8)
      return yield* Effect.fail(
        new CstruckProviderError(
          "request budget",
          "Use 1-8 physical GETs per chunk",
        ),
      );
    let cursor = yield* cstruckValidated("checkpoint", () =>
      CstruckCursor.parse(
        options.startCursor ??
          CstruckCursor.initial(options.previousAcceptedCount),
        options.previousAcceptedCount,
      ),
    );
    const read = options.readPage ?? ((url) => fetchCstruckPage(url, gate));
    let pagesProcessed = 0;
    const started = Date.now();
    while (cursor.phase !== "complete") {
      if (cursor.phase === "ready") {
        const ready = cursor;
        const snapshot = yield* cstruckValidated(
          "complete source quality",
          () =>
            cstruckSnapshot(
              cstruckRoster(ready.pages, ready.total),
              options.previousAcceptedCount,
            ),
        );
        if (options.onYards) yield* options.onYards([CSTRUCK_YARD]);
        yield* options.onBatch(snapshot.vehicles);
        cursor = CstruckCursor.complete(cursor);
        return {
          source: "cstruck" as const,
          status: "complete" as const,
          cursor,
          count: snapshot.vehicles.length,
          pagesProcessed,
          accounting: snapshot.accounting,
          observedVins: snapshot.observedVins,
          errors: [],
          warnings: snapshot.rejects.map(
            (r) =>
              `C&S item ${r.id}: ${r.reason}; valid rejected VIN retained as observed presence.`,
          ),
        };
      }
      if (pagesProcessed >= budget || Date.now() - started >= 60_000) break;
      if (
        cursor.startedAt &&
        (Date.now() < cursor.startedAt ||
          Date.now() - cursor.startedAt > 3_600_000)
      )
        return yield* Effect.fail(
          new CstruckProviderError(
            "run lifetime",
            "Census exceeded one hour; restart the complete census",
          ),
        );
      const current = cursor;
      const url = yield* cstruckValidated("next native control", () =>
        cstruckNextUrl(current),
      );
      const raw = yield* read(url);
      cursor = yield* cstruckValidated("native census " + url, () =>
        cstruckAdvance(current, raw),
      );
      pagesProcessed++;
    }
    return {
      source: "cstruck" as const,
      status:
        cursor.phase === "complete"
          ? ("complete" as const)
          : ("paused" as const),
      cursor,
      count: 0,
      pagesProcessed,
      accounting: {
        recordsProcessed: 0,
        recordsRejected: 0,
        recordsExcluded: 0,
        duplicateVehicles: 0,
      },
      observedVins: [],
      errors: [],
      warnings: [],
    };
  }).pipe(
    Effect.timeoutFail({
      duration: "4 minutes",
      onTimeout: () =>
        new CstruckProviderError(
          "chunk deadline",
          "Four-minute limit exceeded; retain the last validated checkpoint",
        ),
    }),
  );
}
