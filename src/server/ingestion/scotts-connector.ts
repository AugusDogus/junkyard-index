import { ingestionValidation } from "./ingestion-validation";
import { Effect } from "effect";
import type {
  ConnectorChunkAccounting,
  ConnectorChunkStatus,
} from "./connector-chunk";
import { ScottsProviderError, fetchScottsPage } from "./scotts-client";
import {
  ScottsCursor,
  ScottsCursorSchema,
  SCOTTS_MAX_REQUESTS,
  scottsClosingControls,
  type ScottsProgress,
} from "./scotts-cursor";
import {
  scottsHash,
  parseScottsDirectory,
  parseScottsModel,
  parseScottsRoot,
} from "./scotts-parser";
import {
  scottsModels,
  scottsSnapshot,
  validateScottsSnapshot,
} from "./scotts-snapshot";
import {
  SCOTTS_MAKES,
  SCOTTS_ORIGIN,
  SCOTTS_ROOT,
  SCOTTS_YARD,
  type ScottsYard,
} from "./scotts-yard-metadata";
import type { ScottsCanonicalVehicle } from "./scotts-transform";
import type { ProviderRequestGate } from "./provider-http-client";

interface ScottsOptions<E, R> {
  startCursor?: ScottsCursor;
  maxPages?: number;
  onBatch: (vehicles: ScottsCanonicalVehicle[]) => Effect.Effect<void, E, R>;
  onYards?: (yards: ScottsYard[]) => Effect.Effect<void, E, R>;
}
export interface ScottsStreamResult {
  source: "scotts";
  status: ConnectorChunkStatus;
  cursor: ScottsCursor;
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
    catch: (cause) => new ScottsProviderError({ operation, cause }),
  });
const same = (expected: unknown, actual: unknown, label: string) => {
  if (scottsHash(expected) !== scottsHash(actual))
    throw new Error(
      "Closing Scotts " +
        label +
        " changed; preserve prior inventory and inspect the native graph",
    );
};
function nextUrl(state: ScottsProgress): string {
  switch (state.phase) {
    case "root":
      return SCOTTS_ROOT;
    case "directory":
      return SCOTTS_MAKES;
    case "makes": {
      const make = state.makes.find((make) => make.models === null);
      if (!make) throw new Error("Scotts next published make is missing");
      return SCOTTS_ORIGIN + make.path;
    }
    case "models": {
      const entry = scottsModels(state.makes)[state.pages.length];
      if (!entry) throw new Error("Scotts next published model is missing");
      return SCOTTS_ORIGIN + entry.model.path;
    }
    case "closing": {
      const entry = scottsClosingControls(state)[state.closing];
      if (!entry) throw new Error("Scotts closing native control is missing");
      return entry.url;
    }
  }
}
function advance(state: ScottsProgress, raw: string): ScottsProgress {
  const next = { ...state, requests: state.requests + 1 };
  switch (state.phase) {
    case "root":
      next.root = parseScottsRoot(raw);
      next.phase = "directory";
      break;
    case "directory":
      next.makes = parseScottsDirectory(raw, "makes").map((make) => ({
        ...make,
        models: null,
      }));
      next.phase = "makes";
      break;
    case "makes": {
      const index = state.makes.findIndex((make) => make.models === null);
      const make = state.makes[index];
      if (!make) throw new Error("Scotts published make context is missing");
      next.makes = state.makes.map((value, i) =>
        i === index
          ? { ...value, models: parseScottsDirectory(raw, "models", make) }
          : value,
      );
      if (next.makes.every((value) => value.models !== null))
        next.phase = "models";
      break;
    }
    case "models": {
      const entry = scottsModels(state.makes)[state.pages.length];
      if (!entry) throw new Error("Scotts published model context is missing");
      next.pages = [
        ...state.pages,
        parseScottsModel(raw, entry.make, entry.model),
      ];
      if (next.pages.length === scottsModels(state.makes).length)
        next.phase = "closing";
      break;
    }
    case "closing": {
      const entry = scottsClosingControls(state)[state.closing];
      if (!entry) throw new Error("Scotts closing context is missing");
      switch (entry.kind) {
        case "root":
          same(state.root, parseScottsRoot(raw), "official owner");
          break;
        case "directory":
          same(
            state.makes.map(({ models: _models, ...make }) => make),
            parseScottsDirectory(raw, "makes"),
            "make graph",
          );
          break;
        case "make":
          same(
            entry.make.models,
            parseScottsDirectory(raw, "models", entry.make),
            "model graph",
          );
          break;
        case "model":
          same(
            state.pages[entry.index]?.hash,
            parseScottsModel(raw, entry.make, entry.model).hash,
            "model cards",
          );
          break;
      }
      next.closing++;
      break;
    }
  }
  return ScottsCursor.checkpoint(next);
}
export function streamScottsInventoryWithRequestGate<E, R>(
  options: ScottsOptions<E, R>,
  gate: ProviderRequestGate,
) {
  return Effect.gen(function* () {
    const budget = options.maxPages ?? 6;
    if (!Number.isSafeInteger(budget) || budget < 1 || budget > 6)
      return yield* new ScottsProviderError({
        operation: "request budget",
        cause: "Use an integer from 1 to 6 native GETs",
      });
    let cursor = yield* attempt("checkpoint", () =>
      ScottsCursorSchema.parse(options.startCursor ?? ScottsCursor.initial),
    );
    const summary: ScottsStreamResult = {
      source: "scotts",
      status: "paused",
      cursor,
      count: 0,
      pagesProcessed: 0,
      errors: [],
      warnings: [],
      observedVins: [],
      accounting: {
        recordsProcessed: 0,
        recordsExcluded: 0,
        recordsRejected: 0,
        duplicateVehicles: 0,
      },
    };
    if (cursor.phase === "complete")
      return { ...summary, status: "complete" as const };
    while (summary.pagesProcessed < budget && cursor.phase !== "complete") {
      const current: ScottsProgress = cursor;
      if (current.requests >= SCOTTS_MAX_REQUESTS)
        return yield* new ScottsProviderError({
          operation: "request ceiling",
          cause: "600 native GET limit reached; preserve prior inventory",
        });
      const url = yield* attempt("next control", () => nextUrl(current));
      const raw = yield* fetchScottsPage(url, gate);
      const advanced: ScottsProgress = yield* attempt(
        url,
        (): ScottsProgress => advance(current, raw),
      );
      summary.pagesProcessed++;
      if (
        advanced.phase === "closing" &&
        advanced.closing === scottsClosingControls(advanced).length
      ) {
        const snapshot = yield* attempt("complete native graph", () => {
          const value = scottsSnapshot(advanced.makes, advanced.pages);
          validateScottsSnapshot(value);
          return value;
        });
        summary.accounting = { ...snapshot.accounting };
        summary.count = snapshot.vehicles.length;
        summary.observedVins = [...snapshot.observedVins];
        summary.warnings = [
          "Scotts quarantines all required VIN/YMM/destination conflicts and preserves rejected valid VIN presence. Badge deltas are snapshot observations; optional metadata is nullable.",
        ];
        if (options.onYards) yield* options.onYards([{ ...SCOTTS_YARD }]);
        yield* options.onBatch(
          snapshot.vehicles.map((vehicle) => ({ ...vehicle })),
        );
        cursor = { source: "scotts", version: 1, phase: "complete" };
      } else cursor = advanced;
    }
    return {
      ...summary,
      cursor,
      status: cursor.phase === "complete" ? "complete" : "paused",
    } satisfies ScottsStreamResult;
  }).pipe(
    Effect.timeoutFail({
      duration: "3 minutes",
      onTimeout: () =>
        new ScottsProviderError({
          operation: "chunk deadline",
          cause:
            "Three-minute limit exceeded; retain the last validated checkpoint",
        }),
    }),
  );
}
export function streamScottsInventory<E, R>(options: ScottsOptions<E, R>) {
  const gate: ProviderRequestGate = (request) =>
    request.pipe(Effect.ensuring(Effect.sleep("5 seconds")));
  return streamScottsInventoryWithRequestGate(options, gate);
}
