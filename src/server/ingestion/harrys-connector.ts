import { ingestionValidation } from "./ingestion-validation";
import type { ConnectorChunkAccounting } from "./connector-chunk";
import { Effect } from "effect";
import { HarrysCursor } from "./harrys-cursor";
import { HarrysProviderError, readHarrysPage } from "./harrys-client";
import { parseHarrysOwner, parseHarrysPage } from "./harrys-parser";
import {
  HARRYS_OWNER,
  HARRYS_PAGE_SIZE,
  HARRYS_YARDS,
  harrysPageUrl,
  type HarrysYard,
} from "./harrys-yard-metadata";
import {
  harrysSnapshot,
  validateHarrysSnapshot,
  type HarrysCanonicalVehicle,
} from "./harrys-transform";
const attempt = <A>(operation: string, run: () => A) =>
  ingestionValidation({
    try: run,
    catch: (cause) => new HarrysProviderError(operation, cause),
  });
export interface HarrysStreamResult {
  source: "harrys";
  status: "paused" | "complete";
  cursor: HarrysCursor;
  count: number;
  pagesProcessed: number;
  errors: string[];
  warnings: string[];
  observedVins: string[];
  accounting: ConnectorChunkAccounting;
}
export interface HarrysOptions<E, R> {
  startCursor?: unknown;
  maxPages?: number;
  readPage?: (url: string) => Effect.Effect<string, HarrysProviderError>;
  onBatch: (vehicles: HarrysCanonicalVehicle[]) => Effect.Effect<void, E, R>;
  onYards?: (yards: HarrysYard[]) => Effect.Effect<void, E, R>;
}
export function streamHarrysInventory<E, R>(options: HarrysOptions<E, R>) {
  return Effect.gen(function* () {
    const budget = options.maxPages ?? 8;
    if (!Number.isInteger(budget) || budget < 1 || budget > 8)
      return yield* Effect.fail(
        new HarrysProviderError(
          "chunk budget",
          "Use 1 through 8 native requests",
        ),
      );
    let cursor = yield* attempt("checkpoint", () =>
      HarrysCursor.parse(options.startCursor ?? HarrysCursor.initial()),
    );
    const summary: Omit<HarrysStreamResult, "cursor" | "status"> = {
      source: "harrys",
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
    const read = options.readPage ?? readHarrysPage;
    const chunkStarted = Date.now();
    while (
      cursor.phase !== "complete" &&
      summary.pagesProcessed < budget &&
      Date.now() - chunkStarted < 120_000
    ) {
      const current = cursor;
      const index =
        current.phase === "opening"
          ? current.pages.length
          : current.phase === "closing"
            ? current.closed
            : 0;
      const raw = yield* read(
        current.phase === "owner" || current.phase === "owner-closing"
          ? HARRYS_OWNER
          : harrysPageUrl(index),
      );
      summary.pagesProcessed++;
      switch (current.phase) {
        case "owner":
          yield* attempt("ownership", () => parseHarrysOwner(raw));
          cursor = HarrysCursor.checkpoint({
            ...current,
            phase: "opening",
            pages: [],
            closed: 0,
          });
          break;
        case "opening":
          cursor = yield* attempt("opening page " + index, () => {
            const page = parseHarrysPage(raw, index),
              pages = [...current.pages, page];
            return HarrysCursor.checkpoint({
              ...current,
              pages,
              phase:
                pages.length === Math.ceil(page.total / HARRYS_PAGE_SIZE)
                  ? "closing"
                  : "opening",
            });
          });
          break;
        case "closing":
          cursor = yield* attempt("closing page " + index, () => {
            const page = parseHarrysPage(raw, index);
            if (JSON.stringify(page) !== JSON.stringify(current.pages[index]))
              throw new Error(
                "Closing census changed a donor, multiplicity, order or total",
              );
            const closed = current.closed + 1;
            return HarrysCursor.checkpoint({
              ...current,
              closed,
              phase:
                closed === current.pages.length ? "owner-closing" : "closing",
            });
          });
          break;
        case "owner-closing": {
          const snapshot = yield* attempt("complete inventory", () => {
            parseHarrysOwner(raw);
            const result = harrysSnapshot(
              current.pages.flatMap((p) => p.records),
            );
            validateHarrysSnapshot(
              result,
              current.pages.flatMap((page) => page.records),
            );
            return result;
          });
          if (options.onYards)
            yield* options.onYards(HARRYS_YARDS.map((y) => ({ ...y })));
          yield* options.onBatch(snapshot.vehicles);
          summary.count = snapshot.vehicles.length;
          summary.accounting = snapshot.accounting;
          summary.observedVins = snapshot.observedVins;
          cursor = HarrysCursor.checkpoint({
            source: current.source,
            version: current.version,
            scope: current.scope,
            phase: "complete",
          });
          break;
        }
      }
    }
    return {
      ...summary,
      cursor,
      status:
        cursor.phase === "complete"
          ? ("complete" as const)
          : ("paused" as const),
    };
  }).pipe(
    Effect.timeoutFail({
      duration: "5 minutes",
      onTimeout: () =>
        new HarrysProviderError(
          "chunk deadline",
          "Five-minute budget exceeded; retain prior checkpoint",
        ),
    }),
  );
}
