import { ingestionValidation } from "./ingestion-validation";
import { Effect } from "effect";
import type { ConnectorChunkAccounting } from "./connector-chunk";
import {
  IndianriverProviderError,
  readIndianriverPage,
} from "./indianriver-client";
import { IndianriverCursor } from "./indianriver-cursor";
import {
  parseIndianriverOwner,
  parseIndianriverPage,
} from "./indianriver-parser";
import {
  indianriverSnapshot,
  validateIndianriverSnapshot,
  type IndianriverCanonicalVehicle,
} from "./indianriver-transform";
import {
  INDIANRIVER_OWNER,
  INDIANRIVER_PAGE_SIZE,
  INDIANRIVER_YARD,
  indianriverPageUrl,
  type IndianriverYard,
} from "./indianriver-yard-metadata";
import { ProviderChunkClock } from "./provider-chunk-clock";

export interface IndianriverOptions<E, R> {
  previousUniqueInventory: number | null;
  startCursor?: unknown;
  maxPages?: number;
  readPage: (url: string) => Effect.Effect<string, IndianriverProviderError>;
  onBatch: (
    vehicles: IndianriverCanonicalVehicle[],
  ) => Effect.Effect<void, E, R>;
  onYards?: (yards: IndianriverYard[]) => Effect.Effect<void, E, R>;
}
export interface IndianriverStreamResult {
  source: "indianriver";
  status: "paused" | "complete";
  cursor: IndianriverCursor;
  count: number;
  pagesProcessed: number;
  errors: string[];
  warnings: string[];
  observedVins: string[];
  accounting: ConnectorChunkAccounting;
}
const attempt = <A>(operation: string, run: () => A) =>
  ingestionValidation({
    try: run,
    catch: (cause) => new IndianriverProviderError(operation, cause),
  });
export function streamIndianriverInventory<E, R>(
  options: IndianriverOptions<E, R>,
) {
  return Effect.gen(function* () {
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
        new IndianriverProviderError(
          "run options",
          "Use a GET budget from 1 to 8 and a nonnegative previous complete count",
        ),
      );
    let cursor = yield* attempt("checkpoint", () =>
      IndianriverCursor.parse(
        options.startCursor ?? IndianriverCursor.initial(),
      ),
    );
    const summary: IndianriverStreamResult = {
      source: "indianriver",
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
    while (cursor.phase !== "complete" && summary.pagesProcessed < budget) {
      if (yield* ProviderChunkClock.shouldYield(summary.pagesProcessed)) break;
      const current = cursor;
      const index =
        current.phase === "opening"
          ? current.opening.length
          : current.phase === "closing"
            ? current.closing.length
            : 0;
      const url =
        current.phase === "owner" || current.phase === "owner-closing"
          ? INDIANRIVER_OWNER
          : indianriverPageUrl(index);
      const raw = yield* options.readPage(url);
      summary.pagesProcessed++;
      switch (current.phase) {
        case "owner":
          cursor = yield* attempt("native owner", () =>
            IndianriverCursor.checkpoint({
              source: current.source,
              version: current.version,
              scope: current.scope,
              phase: "opening",
              ownerHash: parseIndianriverOwner(raw),
              opening: [],
            }),
          );
          break;
        case "opening":
          cursor = yield* attempt("opening census page " + index, () => {
            const page = parseIndianriverPage(raw, index),
              opening = [...current.opening, page];
            const complete =
              opening.length === Math.ceil(page.total / INDIANRIVER_PAGE_SIZE);
            return complete
              ? IndianriverCursor.checkpoint({
                  source: current.source,
                  version: current.version,
                  scope: current.scope,
                  ownerHash: current.ownerHash,
                  phase: "closing",
                  opening,
                  closing: [],
                })
              : IndianriverCursor.checkpoint({
                  source: current.source,
                  version: current.version,
                  scope: current.scope,
                  ownerHash: current.ownerHash,
                  phase: "opening",
                  opening,
                });
          });
          break;
        case "closing":
          cursor = yield* attempt("closing census page " + index, () => {
            const page = parseIndianriverPage(raw, index),
              closing = [...current.closing, page];
            return IndianriverCursor.checkpoint({
              source: current.source,
              version: current.version,
              scope: current.scope,
              ownerHash: current.ownerHash,
              phase:
                closing.length === current.opening.length
                  ? "owner-closing"
                  : "closing",
              opening: current.opening,
              closing,
            });
          });
          break;
        case "owner-closing": {
          const result = yield* attempt(
            "complete census quality and ownership closure",
            () => {
              if (parseIndianriverOwner(raw) !== current.ownerHash)
                throw new Error(
                  "Indian River physical ownership changed before emission",
                );
              const opening = indianriverSnapshot(current.opening),
                closing = indianriverSnapshot(current.closing);
              validateIndianriverSnapshot(
                opening,
                options.previousUniqueInventory,
              );
              validateIndianriverSnapshot(
                closing,
                options.previousUniqueInventory,
              );
              const dates = new Map(
                closing.vehicles.map((v) => [v.vin, v.availableDate]),
              );
              for (const vehicle of opening.vehicles)
                if (dates.get(vehicle.vin) !== vehicle.availableDate)
                  vehicle.availableDate = null;
              return opening;
            },
          );
          if (options.onYards)
            yield* options.onYards([{ ...INDIANRIVER_YARD }]);
          yield* options.onBatch(result.vehicles);
          summary.count = result.vehicles.length;
          summary.accounting = result.accounting;
          summary.observedVins = result.observedVins;
          summary.warnings.push(
            "Native column Row contains vehicle identity numbers, not yard positions. Paperwork labels do not indicate donor removal. Shared paperwork detail slugs are replaced by the searchable native catalog destination; unstructured reference text is retained in checkpoints without inventing optional attributes.",
          );
          cursor = IndianriverCursor.checkpoint({
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
      status: cursor.phase === "complete" ? "complete" : "paused",
    } satisfies IndianriverStreamResult;
  }).pipe(
    ProviderChunkClock.deadline({
      duration: "3 minutes",
      onTimeout: () =>
        new IndianriverProviderError(
          "chunk deadline",
          "Three-minute limit exceeded; retain the last validated checkpoint",
        ),
    }),
  );
}
export function streamIndianriverInventoryFromProvider<E, R>(
  options: Omit<IndianriverOptions<E, R>, "readPage">,
) {
  return streamIndianriverInventory({
    ...options,
    readPage: readIndianriverPage,
  });
}
