import { ingestionValidation } from "./ingestion-validation";
import { Effect } from "effect";
import type { ConnectorChunkAccounting } from "./connector-chunk";
import { readSandwPage, SandwProviderError } from "./sandw-client";
import { SandwCursor } from "./sandw-cursor";
import {
  parseSandwInventory,
  parseSandwOwner,
  parseSandwScope,
} from "./sandw-parser";
import {
  sandwSnapshot,
  validateSandwSnapshot,
  type SandwCanonicalVehicle,
} from "./sandw-transform";
import {
  SANDW_API,
  SANDW_CATALOG,
  SANDW_OWNER,
  SANDW_YARD,
  type SandwYard,
} from "./sandw-yard-metadata";

export interface SandwOptions<E, R> {
  previousUniqueInventory: number | null;
  startCursor?: unknown;
  maxPages?: number;
  readPage: (url: string) => Effect.Effect<string, SandwProviderError>;
  onBatch: (vehicles: SandwCanonicalVehicle[]) => Effect.Effect<void, E, R>;
  onYards?: (yards: SandwYard[]) => Effect.Effect<void, E, R>;
}
export interface SandwStreamResult {
  source: "sandw";
  status: "paused" | "complete";
  cursor: SandwCursor;
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
    catch: (cause) => new SandwProviderError(operation, cause),
  });

export function streamSandwInventory<E, R>(options: SandwOptions<E, R>) {
  return Effect.gen(function* () {
    const budget = options.maxPages ?? 5;
    if (
      !Number.isSafeInteger(budget) ||
      budget < 1 ||
      budget > 8 ||
      (options.previousUniqueInventory !== null &&
        (!Number.isSafeInteger(options.previousUniqueInventory) ||
          options.previousUniqueInventory < 0))
    )
      return yield* Effect.fail(
        new SandwProviderError(
          "run options",
          "Use a GET budget from 1 to 8 and a nonnegative previous complete count",
        ),
      );
    let cursor = yield* attempt("checkpoint", () =>
      SandwCursor.parse(options.startCursor ?? SandwCursor.initial()),
    );
    const summary: SandwStreamResult = {
      source: "sandw",
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
      const current = cursor;
      const url =
        current.phase === "owner" || current.phase === "owner-closing"
          ? SANDW_OWNER
          : current.phase === "scope"
            ? SANDW_CATALOG
            : SANDW_API;
      const raw = yield* options.readPage(url);
      summary.pagesProcessed++;
      switch (current.phase) {
        case "owner":
          cursor = yield* attempt("native owner", () =>
            SandwCursor.next(current, "scope", parseSandwOwner(raw)),
          );
          break;
        case "scope":
          cursor = yield* attempt("native catalog scope", () => {
            parseSandwScope(raw);
            return SandwCursor.next(current, "catalog", current.ownerHash);
          });
          break;
        case "catalog":
          cursor = yield* attempt("complete public report", () =>
            SandwCursor.checkpoint({
              source: current.source,
              version: current.version,
              scope: current.scope,
              ownerHash: current.ownerHash,
              phase: "closing",
              opening: parseSandwInventory(raw),
            }),
          );
          break;
        case "closing":
          cursor = yield* attempt("closing public report", () =>
            SandwCursor.checkpoint({
              source: current.source,
              version: current.version,
              scope: current.scope,
              ownerHash: current.ownerHash,
              opening: current.opening,
              phase: "owner-closing",
              closing: parseSandwInventory(raw),
            }),
          );
          break;
        case "owner-closing": {
          const result = yield* attempt(
            "complete census quality and ownership closure",
            () => {
              if (parseSandwOwner(raw) !== current.ownerHash)
                throw new Error("Native owner changed before emission");
              const opening = sandwSnapshot(current.opening),
                closing = sandwSnapshot(current.closing);
              validateSandwSnapshot(opening, options.previousUniqueInventory);
              validateSandwSnapshot(closing, options.previousUniqueInventory);
              const closed = new Map(
                closing.vehicles.map((vehicle) => [vehicle.vin, vehicle]),
              );
              for (const vehicle of opening.vehicles) {
                const actual = closed.get(vehicle.vin);
                if (!actual)
                  throw new Error(
                    "Closing accepted donor lost its required-identity binding",
                  );
                for (const key of [
                  "color",
                  "stockNumber",
                  "imageUrl",
                  "availableDate",
                  "row",
                ] as const)
                  if (vehicle[key] !== actual[key]) vehicle[key] = null;
              }
              return opening;
            },
          );
          // Source status is preserved explicitly. Stale is a native cached
          // published inventory, never a claim that CRUSH just synchronized.
          if (current.opening.status === "stale")
            summary.warnings.push(
              `S&W serves cached inventory marked stale; native lastSyncedAt=${current.opening.lastSyncedAt}. Confirm availability with the yard.`,
            );
          if (options.onYards) yield* options.onYards([{ ...SANDW_YARD }]);
          yield* options.onBatch(result.vehicles);
          summary.accounting = result.accounting;
          summary.observedVins = result.observedVins;
          summary.count = result.vehicles.length;
          cursor = SandwCursor.checkpoint({
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
    } satisfies SandwStreamResult;
  }).pipe(
    Effect.timeoutFail({
      duration: "3 minutes",
      onTimeout: () =>
        new SandwProviderError(
          "chunk deadline",
          "Three-minute limit exceeded; retain the last validated checkpoint",
        ),
    }),
  );
}

export function streamSandwInventoryFromProvider<E, R>(
  options: Omit<SandwOptions<E, R>, "readPage">,
) {
  return streamSandwInventory({ ...options, readPage: readSandwPage });
}
