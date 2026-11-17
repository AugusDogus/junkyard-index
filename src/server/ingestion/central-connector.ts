import { ingestionValidation } from "./ingestion-validation";
import { Effect } from "effect";
import type {
  ConnectorChunkAccounting,
  ConnectorChunkStatus,
} from "./connector-chunk";
import { CentralProviderError, fetchCentralPage } from "./central-client";
import {
  CentralCursor,
  CentralCursorSchema,
  CENTRAL_MAX_REQUESTS,
  centralClosingControls,
  type CentralProgress,
} from "./central-cursor";
import {
  centralHash,
  parseCentralDirectory,
  parseCentralModel,
  parseCentralRoot,
} from "./central-parser";
import {
  centralModels,
  centralSnapshot,
  validateCentralSnapshot,
} from "./central-snapshot";
import {
  CENTRAL_MAKES,
  CENTRAL_ORIGIN,
  CENTRAL_ROOT,
  CENTRAL_YARD,
  type CentralYard,
} from "./central-yard-metadata";
import type { CentralCanonicalVehicle } from "./central-transform";
import type { ProviderRequestGate } from "./provider-http-client";

interface CentralOptions<E, R> {
  startCursor?: CentralCursor;
  maxPages?: number;
  onBatch: (vehicles: CentralCanonicalVehicle[]) => Effect.Effect<void, E, R>;
  onYards?: (yards: CentralYard[]) => Effect.Effect<void, E, R>;
}
export interface CentralStreamResult {
  source: "central";
  status: ConnectorChunkStatus;
  cursor: CentralCursor;
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
    catch: (cause) => new CentralProviderError({ operation, cause }),
  });
const same = (expected: unknown, actual: unknown, label: string) => {
  if (centralHash(expected) !== centralHash(actual))
    throw new Error(
      "Closing Central " +
        label +
        " changed; preserve prior inventory and inspect the native graph",
    );
};
function nextUrl(state: CentralProgress): string {
  switch (state.phase) {
    case "root":
      return CENTRAL_ROOT;
    case "directory":
      return CENTRAL_MAKES;
    case "makes": {
      const make = state.makes.find((make) => make.models === null);
      if (!make) throw new Error("Central next published make is missing");
      return CENTRAL_ORIGIN + make.path;
    }
    case "models": {
      const entry = centralModels(state.makes)[state.pages.length];
      if (!entry) throw new Error("Central next published model is missing");
      return CENTRAL_ORIGIN + entry.model.path;
    }
    case "closing": {
      const entry = centralClosingControls(state)[state.closing];
      if (!entry) throw new Error("Central closing native control is missing");
      return entry.url;
    }
  }
}
function advance(state: CentralProgress, raw: string): CentralProgress {
  const next = { ...state, requests: state.requests + 1 };
  switch (state.phase) {
    case "root":
      next.root = parseCentralRoot(raw);
      next.phase = "directory";
      break;
    case "directory":
      next.makes = parseCentralDirectory(raw, "makes").map((make) => ({
        ...make,
        models: null,
      }));
      next.phase = "makes";
      break;
    case "makes": {
      const index = state.makes.findIndex((make) => make.models === null);
      const make = state.makes[index];
      if (!make) throw new Error("Central published make context is missing");
      next.makes = state.makes.map((value, i) =>
        i === index
          ? { ...value, models: parseCentralDirectory(raw, "models", make) }
          : value,
      );
      if (next.makes.every((value) => value.models !== null))
        next.phase = "models";
      break;
    }
    case "models": {
      const entry = centralModels(state.makes)[state.pages.length];
      if (!entry) throw new Error("Central published model context is missing");
      next.pages = [
        ...state.pages,
        parseCentralModel(raw, entry.make, entry.model),
      ];
      if (next.pages.length === centralModels(state.makes).length)
        next.phase = "closing";
      break;
    }
    case "closing": {
      const entry = centralClosingControls(state)[state.closing];
      if (!entry) throw new Error("Central closing context is missing");
      switch (entry.kind) {
        case "root":
          same(state.root, parseCentralRoot(raw), "official owner");
          break;
        case "directory":
          same(
            state.makes.map(({ models: _models, ...make }) => make),
            parseCentralDirectory(raw, "makes"),
            "make graph",
          );
          break;
        case "make":
          same(
            entry.make.models,
            parseCentralDirectory(raw, "models", entry.make),
            "model graph",
          );
          break;
        case "model":
          same(
            state.pages[entry.index]?.hash,
            parseCentralModel(raw, entry.make, entry.model).hash,
            "model cards",
          );
          break;
      }
      next.closing++;
      break;
    }
  }
  return CentralCursor.checkpoint(next);
}
export function streamCentralInventoryWithRequestGate<E, R>(
  options: CentralOptions<E, R>,
  gate: ProviderRequestGate,
) {
  return Effect.gen(function* () {
    const budget = options.maxPages ?? 8;
    if (!Number.isSafeInteger(budget) || budget < 1 || budget > 8)
      return yield* new CentralProviderError({
        operation: "request budget",
        cause: "Use an integer from 1 to 8 native GETs",
      });
    let cursor = yield* attempt("checkpoint", () =>
      CentralCursorSchema.parse(options.startCursor ?? CentralCursor.initial),
    );
    const summary: CentralStreamResult = {
      source: "central",
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
      const current: CentralProgress = cursor;
      if (current.requests >= CENTRAL_MAX_REQUESTS)
        return yield* new CentralProviderError({
          operation: "request ceiling",
          cause: "1600 native GET limit reached; preserve prior inventory",
        });
      const url = yield* attempt("next control", () => nextUrl(current));
      const raw = yield* fetchCentralPage(url, gate);
      const advanced: CentralProgress = yield* attempt(
        url,
        (): CentralProgress => advance(current, raw),
      );
      summary.pagesProcessed++;
      if (
        advanced.phase === "closing" &&
        advanced.closing === centralClosingControls(advanced).length
      ) {
        const snapshot = yield* attempt("complete native graph", () => {
          const value = centralSnapshot(advanced.makes, advanced.pages);
          validateCentralSnapshot(value);
          return value;
        });
        summary.accounting = { ...snapshot.accounting };
        summary.count = snapshot.vehicles.length;
        summary.observedVins = [...snapshot.observedVins];
        summary.warnings = [
          "Central quarantines all required VIN/YMM/destination conflicts and preserves rejected valid VIN presence. Badge deltas are snapshot observations; optional metadata is nullable.",
        ];
        if (options.onYards) yield* options.onYards([{ ...CENTRAL_YARD }]);
        yield* options.onBatch(
          snapshot.vehicles.map((vehicle) => ({ ...vehicle })),
        );
        cursor = { source: "central", version: 1, phase: "complete" };
      } else cursor = advanced;
    }
    return {
      ...summary,
      cursor,
      status: cursor.phase === "complete" ? "complete" : "paused",
    } satisfies CentralStreamResult;
  }).pipe(
    Effect.timeoutFail({
      duration: "3 minutes",
      onTimeout: () =>
        new CentralProviderError({
          operation: "chunk deadline",
          cause:
            "Three-minute limit exceeded; retain the last validated checkpoint",
        }),
    }),
  );
}
export function streamCentralInventory<E, R>(options: CentralOptions<E, R>) {
  const gate: ProviderRequestGate = (request) =>
    request.pipe(Effect.ensuring(Effect.sleep("1600 millis")));
  return streamCentralInventoryWithRequestGate(options, gate);
}
