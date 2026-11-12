import { Effect } from "effect";
import type {
  ConnectorChunkAccounting,
  ConnectorChunkStatus,
} from "./connector-chunk";
import { ChazProviderError, fetchChazPage } from "./chaz-client";
import {
  ChazCursor,
  ChazCursorSchema,
  CHAZ_MAX_REQUESTS,
  chazClosingControls,
  type ChazProgress,
} from "./chaz-cursor";
import {
  chazHash,
  parseChazContact,
  parseChazDirectory,
  parseChazModel,
  parseChazRoot,
} from "./chaz-parser";
import {
  chazModels,
  chazSnapshot,
  validateChazSnapshot,
} from "./chaz-snapshot";
import {
  CHAZ_CONTACT,
  CHAZ_MAKES,
  CHAZ_ORIGIN,
  CHAZ_ROOT,
  CHAZ_YARD,
  type ChazYard,
} from "./chaz-yard-metadata";
import type { ChazCanonicalVehicle } from "./chaz-transform";
import type { ProviderRequestGate } from "./provider-http-client";

interface ChazOptions<E, R> {
  startCursor?: ChazCursor;
  /** One unit is one serial native GET; no donor details or images are fetched. */
  maxPages?: number;
  onBatch: (vehicles: ChazCanonicalVehicle[]) => Effect.Effect<void, E, R>;
  onYards?: (yards: ChazYard[]) => Effect.Effect<void, E, R>;
}
export interface ChazStreamResult {
  source: "chaz";
  status: ConnectorChunkStatus;
  cursor: ChazCursor;
  count: number;
  pagesProcessed: number;
  errors: string[];
  warnings: string[];
  observedVins: string[];
  accounting: ConnectorChunkAccounting;
}
const attempt = <A>(operation: string, run: () => A) =>
  Effect.try({
    try: run,
    catch: (cause) => new ChazProviderError({ operation, cause }),
  });
const same = (expected: unknown, actual: unknown, label: string) => {
  if (chazHash(expected) !== chazHash(actual))
    throw new Error(
      "Closing Chaz " +
        label +
        " changed; restart from the native root after inspection",
    );
};

function nextUrl(state: ChazProgress): string {
  switch (state.phase) {
    case "contact":
      return CHAZ_CONTACT;
    case "root":
      return CHAZ_ROOT;
    case "directory":
      return CHAZ_MAKES;
    case "makes": {
      const make = state.makes.find((m) => m.models === null);
      if (!make) throw new Error("Missing Chaz next published make");
      return CHAZ_ORIGIN + make.path;
    }
    case "models": {
      const next = chazModels(state.makes)[state.pages.length];
      if (!next) throw new Error("Missing Chaz next published model");
      return CHAZ_ORIGIN + next.model.path;
    }
    case "closing": {
      const control = chazClosingControls(state)[state.closing];
      if (!control) throw new Error("Missing Chaz closing control");
      return control.url;
    }
  }
}

function advance(state: ChazProgress, raw: string): ChazProgress {
  const next = { ...state, requests: state.requests + 1 };
  switch (state.phase) {
    case "contact":
      next.contact = parseChazContact(raw);
      next.phase = "root";
      break;
    case "root":
      next.arrivals = [parseChazRoot(raw)];
      next.phase = "directory";
      break;
    case "directory":
      next.makes = parseChazDirectory(raw, "makes").map((make) => ({
        ...make,
        models: null,
      }));
      next.phase = "makes";
      break;
    case "makes": {
      const index = state.makes.findIndex((m) => m.models === null);
      const make = state.makes[index];
      if (!make) throw new Error("Missing Chaz published make context");
      next.makes = state.makes.map((m, i) =>
        i === index
          ? { ...m, models: parseChazDirectory(raw, "models", make) }
          : m,
      );
      if (next.makes.every((m) => m.models !== null)) next.phase = "models";
      break;
    }
    case "models": {
      const context = chazModels(state.makes)[state.pages.length];
      if (!context) throw new Error("Missing Chaz published model context");
      next.pages = [
        ...state.pages,
        parseChazModel(raw, context.make, context.model),
      ];
      if (next.pages.length === chazModels(state.makes).length)
        next.phase = "closing";
      break;
    }
    case "closing": {
      const control = chazClosingControls(state)[state.closing];
      if (!control) throw new Error("Missing Chaz closing native context");
      switch (control.kind) {
        case "contact":
          same(state.contact, parseChazContact(raw), "official ownership");
          break;
        case "directory":
          same(
            state.makes.map(({ models: _models, ...make }) => make),
            parseChazDirectory(raw, "makes"),
            "make directory",
          );
          break;
        case "make":
          same(
            control.make.models,
            parseChazDirectory(raw, "models", control.make),
            "model directory " + control.make.label,
          );
          break;
        case "model":
          same(
            state.pages[control.index]?.hash,
            parseChazModel(raw, control.make, control.model).hash,
            "model list " + control.model.label,
          );
          break;
        case "root":
          next.arrivals = [...state.arrivals, parseChazRoot(raw)];
          break;
      }
      next.closing++;
      break;
    }
  }
  return ChazCursor.checkpoint(next);
}

export function streamChazInventoryWithRequestGate<E, R>(
  options: ChazOptions<E, R>,
  gate: ProviderRequestGate,
) {
  return Effect.gen(function* () {
    const budget = options.maxPages ?? 8;
    if (!Number.isSafeInteger(budget) || budget < 1 || budget > 8)
      return yield* new ChazProviderError({
        operation: "request budget",
        cause: "Use an integer budget from 1 to 8 native GETs",
      });
    let cursor = yield* attempt("checkpoint", () =>
      ChazCursorSchema.parse(options.startCursor ?? ChazCursor.initial),
    );
    const summary: ChazStreamResult = {
      source: "chaz",
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
    const started = Date.now();
    while (summary.pagesProcessed < budget && cursor.phase !== "complete") {
      if (Date.now() - started > 150_000) break;
      if (cursor.requests >= CHAZ_MAX_REQUESTS)
        return yield* new ChazProviderError({
          operation: "run budget",
          cause: "1024 native GET limit reached before terminal closure",
        });
      const current: ChazProgress = cursor;
      const url = yield* attempt("next native control", () => nextUrl(current));
      const raw = yield* fetchChazPage(url, gate);
      const advanced: ChazProgress = yield* attempt(
        "native control " + url,
        (): ChazProgress => advance(current, raw),
      );
      summary.pagesProcessed++;
      if (
        advanced.phase === "closing" &&
        advanced.closing === chazClosingControls(advanced).length
      ) {
        const snapshot = yield* attempt("complete native union", () => {
          const snapshot = chazSnapshot(
            advanced.makes,
            advanced.pages,
            advanced.arrivals,
          );
          validateChazSnapshot(snapshot);
          return snapshot;
        });
        // Capture disjoint terminal accounting before invoking caller-owned code.
        summary.accounting = { ...snapshot.accounting };
        summary.count = snapshot.vehicles.length;
        summary.observedVins = [...snapshot.observedVins];
        summary.warnings = [
          "Chaz preserved required identity rejects and quarantined every conflicting VIN occurrence. Published badge count discrepancies remain raw observations; optional metadata is nullable.",
        ];
        if (options.onYards) yield* options.onYards([{ ...CHAZ_YARD }]);
        yield* options.onBatch(
          snapshot.vehicles.map((vehicle) => ({ ...vehicle })),
        );
        cursor = { source: "chaz", version: 1, phase: "complete" };
      } else cursor = advanced;
    }
    return {
      ...summary,
      cursor,
      status: cursor.phase === "complete" ? "complete" : "paused",
    } satisfies ChazStreamResult;
  }).pipe(
    Effect.timeoutFail({
      duration: "3 minutes",
      onTimeout: () =>
        new ChazProviderError({
          operation: "chunk deadline",
          cause:
            "Three-minute limit exceeded; retain the last validated checkpoint",
        }),
    }),
  );
}

export function streamChazInventory<E, R>(options: ChazOptions<E, R>) {
  // Padding the complete body on both success and failure also bounds starts
  // across serialized chunks whose local limiter would otherwise be reset.
  const gate: ProviderRequestGate = (request) =>
    request.pipe(Effect.ensuring(Effect.sleep("1600 millis")));
  return streamChazInventoryWithRequestGate(options, gate);
}
