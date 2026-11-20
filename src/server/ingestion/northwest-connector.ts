import { ingestionValidation } from "./ingestion-validation";
import { Effect, Option } from "effect";
import type {
  ConnectorChunkAccounting,
  ConnectorChunkStatus,
} from "./connector-chunk";
import { NorthwestProviderError, fetchNorthwestPage } from "./northwest-client";
import {
  NorthwestCursor,
  NorthwestCursorSchema,
  NORTHWEST_MAX_REQUESTS,
  northwestCensus,
  northwestCensusPlan,
  northwestClosingControls,
  northwestCoverageError,
  type NorthwestProgress,
} from "./northwest-cursor";
import { ModelCensus } from "./model-census";
import {
  northwestHash,
  parseNorthwestDirectory,
  parseNorthwestModel,
  parseNorthwestRoot,
} from "./northwest-parser";
import {
  northwestModels,
  northwestSnapshot,
  validateNorthwestSnapshot,
} from "./northwest-catalog";
import {
  NORTHWEST_MAKES,
  NORTHWEST_ORIGIN,
  NORTHWEST_ROOT,
  NORTHWEST_YARD,
  type NorthwestYard,
} from "./northwest-yard-metadata";
import type { NorthwestCandidate } from "./northwest-transform";
import type { ProviderRequestGate } from "./provider-http-client";
import { ProviderChunkClock } from "./provider-chunk-clock";
import { sharedProviderHostTurn } from "./shared-provider-host";

interface NorthwestOptions<E, R> {
  startCursor?: NorthwestCursor;
  /** Terminal cursor of the last accepted, published run; read only when the
   * start cursor has not begun a census yet. */
  previousCursor?: unknown;
  now?: () => number;
  maxPages?: number;
  onBatch: (vehicles: NorthwestCandidate[]) => Effect.Effect<void, E, R>;
  onYards?: (yards: NorthwestYard[]) => Effect.Effect<void, E, R>;
}
export interface NorthwestStreamResult {
  source: "northwest";
  status: ConnectorChunkStatus;
  cursor: NorthwestCursor;
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
    catch: (cause) => new NorthwestProviderError({ operation, cause }),
  });
const same = (expected: unknown, actual: unknown, label: string) => {
  if (northwestHash(expected) !== northwestHash(actual))
    throw new Error(
      "Closing Northwest " +
        label +
        " changed; preserve prior inventory and inspect the native graph",
    );
};
function nextUrl(state: NorthwestProgress): string {
  switch (state.phase) {
    case "root":
      return NORTHWEST_ROOT;
    case "directory":
      return NORTHWEST_MAKES;
    case "makes": {
      const make = state.makes.find((make) => make.models === null);
      if (!make) throw new Error("Northwest next published make is missing");
      return NORTHWEST_ORIGIN + make.path;
    }
    case "models": {
      const entry = northwestModels(state.makes)[state.pages.length];
      if (!entry) throw new Error("Northwest next published model is missing");
      return NORTHWEST_ORIGIN + entry.model.path;
    }
    case "closing": {
      const entry = northwestClosingControls(state)[state.closing];
      if (!entry)
        throw new Error("Northwest closing native control is missing");
      return entry.url;
    }
  }
}
function advance(state: NorthwestProgress, raw: string): NorthwestProgress {
  const next = { ...state, requests: state.requests + 1 };
  switch (state.phase) {
    case "root":
      next.root = parseNorthwestRoot(raw);
      next.phase = "directory";
      break;
    case "directory":
      next.makes = parseNorthwestDirectory(raw, "makes").map((make) => ({
        ...make,
        models: null,
      }));
      next.phase = "makes";
      break;
    case "makes": {
      const index = state.makes.findIndex((make) => make.models === null);
      const make = state.makes[index];
      if (!make) throw new Error("Northwest published make context is missing");
      next.makes = state.makes.map((value, i) =>
        i === index
          ? { ...value, models: parseNorthwestDirectory(raw, "models", make) }
          : value,
      );
      if (next.makes.every((value) => value.models !== null)) {
        // Carried models before the first due read cost no request.
        next.pages = ModelCensus.carriedRun(northwestCensusPlan(next), 0);
        next.phase =
          next.pages.length === northwestModels(next.makes).length
            ? "closing"
            : "models";
      }
      break;
    }
    case "models": {
      const entry = northwestModels(state.makes)[state.pages.length];
      if (!entry)
        throw new Error("Northwest published model context is missing");
      next.pages = [
        ...state.pages,
        parseNorthwestModel(raw, entry.make, entry.model),
        ...ModelCensus.carriedRun(
          northwestCensusPlan(state),
          state.pages.length + 1,
        ),
      ];
      if (next.pages.length === northwestModels(state.makes).length)
        next.phase = "closing";
      break;
    }
    case "closing": {
      const entry = northwestClosingControls(state)[state.closing];
      if (!entry) throw new Error("Northwest closing context is missing");
      switch (entry.kind) {
        case "root":
          same(state.root, parseNorthwestRoot(raw), "official owner");
          break;
        case "directory":
          same(
            state.makes.map(({ models: _models, ...make }) => make),
            parseNorthwestDirectory(raw, "makes"),
            "make graph",
          );
          break;
        case "model":
          same(
            state.pages[entry.index]?.hash,
            parseNorthwestModel(raw, entry.make, entry.model).hash,
            "model list " + entry.model.label,
          );
          break;
      }
      next.closing++;
      break;
    }
  }
  return NorthwestCursor.checkpoint(next);
}
export function streamNorthwestInventoryWithRequestGate<E, R>(
  options: NorthwestOptions<E, R>,
  gate: ProviderRequestGate,
) {
  return Effect.gen(function* () {
    const budget = options.maxPages ?? 8;
    if (!Number.isSafeInteger(budget) || budget < 1 || budget > 8)
      return yield* new NorthwestProviderError({
        operation: "request budget",
        cause: "Use an integer from 1 to 8 native GETs",
      });
    let cursor = yield* attempt("checkpoint", () =>
      NorthwestCursorSchema.parse(
        options.startCursor ?? NorthwestCursor.initial,
      ),
    );
    const summary: NorthwestStreamResult = {
      source: "northwest",
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
    const now = options.now ?? Date.now;
    const pending = cursor;
    const begun = yield* attempt("begin census", () =>
      NorthwestCursor.begin(pending, now(), options.previousCursor),
    );
    cursor = begun.cursor;
    summary.cursor = cursor;
    if (begun.warning) summary.warnings.push(begun.warning);
    while (summary.pagesProcessed < budget && cursor.phase !== "complete") {
      const current: NorthwestProgress = cursor;
      if (current.requests >= NORTHWEST_MAX_REQUESTS)
        return yield* new NorthwestProviderError({
          operation: "request ceiling",
          cause: "1600 native GET limit reached; preserve prior inventory",
        });
      const url = yield* attempt("next control", () => nextUrl(current));
      const page = yield* fetchNorthwestPage(url, gate).pipe(
        sharedProviderHostTurn(url),
        ProviderChunkClock.unlessDeferred(summary.pagesProcessed > 0),
      );
      if (Option.isNone(page)) break;
      const raw = page.value;
      const advanced: NorthwestProgress = yield* attempt(
        url,
        (): NorthwestProgress => advance(current, raw),
      );
      summary.pagesProcessed++;
      if (
        advanced.phase === "closing" &&
        advanced.closing === northwestClosingControls(advanced).length
      ) {
        const snapshot = yield* attempt("complete native graph", () => {
          const shortfall = northwestCoverageError(advanced);
          if (shortfall) throw new Error(shortfall);
          const value = northwestSnapshot(advanced.makes, advanced.pages);
          validateNorthwestSnapshot(value);
          return value;
        });
        summary.accounting = { ...snapshot.accounting };
        summary.count = snapshot.vehicles.length;
        summary.observedVins = [...snapshot.observedVins];
        const census = yield* attempt("close model census", () =>
          northwestCensus(advanced),
        );
        summary.warnings = [
          ...summary.warnings,
          ...snapshot.warnings,
          "Northwest " + ModelCensus.summary(northwestCensusPlan(advanced)),
        ];
        if (options.onYards) yield* options.onYards([{ ...NORTHWEST_YARD }]);
        yield* options.onBatch(
          snapshot.vehicles.map((vehicle) => ({ ...vehicle })),
        );
        cursor = {
          source: "northwest",
          version: 1,
          phase: "complete",
          census,
        };
      } else cursor = advanced;
    }
    return {
      ...summary,
      cursor,
      status: cursor.phase === "complete" ? "complete" : "paused",
    } satisfies NorthwestStreamResult;
  }).pipe(
    ProviderChunkClock.deadline({
      duration: "3 minutes",
      onTimeout: () =>
        new NorthwestProviderError({
          operation: "chunk deadline",
          cause:
            "Three-minute limit exceeded; retain the last validated checkpoint",
        }),
    }),
  );
}
export function streamNorthwestInventory<E, R>(
  options: NorthwestOptions<E, R>,
) {
  const gate: ProviderRequestGate = (request) =>
    request.pipe(Effect.ensuring(Effect.sleep("1600 millis")));
  return streamNorthwestInventoryWithRequestGate(options, gate);
}
