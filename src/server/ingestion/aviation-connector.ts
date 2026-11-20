import { ingestionValidation } from "./ingestion-validation";
import { Effect, Option } from "effect";
import type {
  ConnectorChunkAccounting,
  ConnectorChunkStatus,
} from "./connector-chunk";
import { AviationProviderError, fetchAviationPage } from "./aviation-client";
import {
  AviationCursor,
  AviationCursorSchema,
  AVIATION_MAX_REQUESTS,
  aviationCensus,
  aviationCensusPlan,
  aviationClosingControls,
  type AviationProgress,
} from "./aviation-cursor";
import { ModelCensus } from "./model-census";
import {
  aviationHash,
  parseAviationContact,
  parseAviationDirectory,
  parseAviationModel,
  parseAviationRoot,
} from "./aviation-parser";
import {
  aviationModels,
  aviationSnapshot,
  validateAviationSnapshot,
} from "./aviation-snapshot";
import {
  AVIATION_CONTACT,
  AVIATION_MAKES,
  AVIATION_ORIGIN,
  AVIATION_PARTS,
  AVIATION_ROOT,
  AVIATION_YARD,
  type AviationYard,
} from "./aviation-yard-metadata";
import type { AviationCanonicalVehicle } from "./aviation-transform";
import type { ProviderRequestGate } from "./provider-http-client";
import { ProviderChunkClock } from "./provider-chunk-clock";
import { sharedProviderHostTurn } from "./shared-provider-host";

interface AviationOptions<E, R> {
  startCursor?: AviationCursor;
  /** Terminal cursor of the last accepted, published run; read only when the
   * start cursor has not begun a census yet. */
  previousCursor?: unknown;
  now?: () => number;
  /** One unit is one serial native GET; no donor details or images are fetched. */
  maxPages?: number;
  onBatch: (vehicles: AviationCanonicalVehicle[]) => Effect.Effect<void, E, R>;
  onYards?: (yards: AviationYard[]) => Effect.Effect<void, E, R>;
}
export interface AviationStreamResult {
  source: "aviation";
  status: ConnectorChunkStatus;
  cursor: AviationCursor;
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
    catch: (cause) => new AviationProviderError({ operation, cause }),
  });
const same = (expected: unknown, actual: unknown, label: string) => {
  if (aviationHash(expected) !== aviationHash(actual))
    throw new Error(
      "Closing Aviation " +
        label +
        " changed; restart from the native root after inspection",
    );
};

function nextUrl(state: AviationProgress): string {
  switch (state.phase) {
    case "contact":
      return AVIATION_CONTACT;
    case "root":
      return AVIATION_ROOT;
    case "directory":
      return AVIATION_PARTS;
    case "configured":
      return AVIATION_MAKES;
    case "makes": {
      const make = state.makes.find((m) => m.models === null);
      if (!make) throw new Error("Missing Aviation next published make");
      return AVIATION_ORIGIN + make.path;
    }
    case "models": {
      const next = aviationModels(state.makes)[state.pages.length];
      if (!next) throw new Error("Missing Aviation next published model");
      return AVIATION_ORIGIN + next.model.path;
    }
    case "closing": {
      const control = aviationClosingControls(state)[state.closing];
      if (!control) throw new Error("Missing Aviation closing control");
      return control.url;
    }
  }
}

function advance(state: AviationProgress, raw: string): AviationProgress {
  const next = { ...state, requests: state.requests + 1 };
  switch (state.phase) {
    case "contact":
      next.contact = parseAviationContact(raw);
      next.phase = "root";
      break;
    case "root":
      next.arrivals = [parseAviationRoot(raw)];
      next.phase = "directory";
      break;
    case "directory":
      next.makes = parseAviationDirectory(raw, "makes").map((make) => ({
        ...make,
        models: null,
      }));
      next.phase = "configured";
      break;
    case "configured":
      same(
        state.makes.map(({ models: _models, ...make }) => make),
        parseAviationDirectory(raw, "makes"),
        "configured make graph",
      );
      next.phase = "makes";
      break;
    case "makes": {
      const index = state.makes.findIndex((m) => m.models === null);
      const make = state.makes[index];
      if (!make) throw new Error("Missing Aviation published make context");
      next.makes = state.makes.map((m, i) =>
        i === index
          ? { ...m, models: parseAviationDirectory(raw, "models", make) }
          : m,
      );
      if (next.makes.every((m) => m.models !== null)) {
        // Carried models before the first due read cost no request.
        next.pages = ModelCensus.carriedRun(aviationCensusPlan(next), 0);
        next.phase =
          next.pages.length === aviationModels(next.makes).length
            ? "closing"
            : "models";
      }
      break;
    }
    case "models": {
      const context = aviationModels(state.makes)[state.pages.length];
      if (!context) throw new Error("Missing Aviation published model context");
      next.pages = [
        ...state.pages,
        parseAviationModel(raw, context.make, context.model),
        ...ModelCensus.carriedRun(
          aviationCensusPlan(state),
          state.pages.length + 1,
        ),
      ];
      if (next.pages.length === aviationModels(state.makes).length)
        next.phase = "closing";
      break;
    }
    case "closing": {
      const control = aviationClosingControls(state)[state.closing];
      if (!control) throw new Error("Missing Aviation closing native context");
      switch (control.kind) {
        case "contact":
          same(state.contact, parseAviationContact(raw), "official ownership");
          break;
        case "directory":
          same(
            state.makes.map(({ models: _models, ...make }) => make),
            parseAviationDirectory(raw, "makes"),
            "make directory",
          );
          break;
        case "model":
          same(
            state.pages[control.index]?.hash,
            parseAviationModel(raw, control.make, control.model).hash,
            "model list " + control.model.label,
          );
          break;
      }
      next.closing++;
      break;
    }
  }
  return AviationCursor.checkpoint(next);
}

export function streamAviationInventoryWithRequestGate<E, R>(
  options: AviationOptions<E, R>,
  gate: ProviderRequestGate,
) {
  return Effect.gen(function* () {
    const budget = options.maxPages ?? 8;
    if (!Number.isSafeInteger(budget) || budget < 1 || budget > 8)
      return yield* new AviationProviderError({
        operation: "request budget",
        cause: "Use an integer budget from 1 to 8 native GETs",
      });
    let cursor = yield* attempt("checkpoint", () =>
      AviationCursorSchema.parse(options.startCursor ?? AviationCursor.initial),
    );
    const summary: AviationStreamResult = {
      source: "aviation",
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
      AviationCursor.begin(pending, now(), options.previousCursor),
    );
    cursor = begun.cursor;
    summary.cursor = cursor;
    if (begun.warning) summary.warnings.push(begun.warning);
    const started = Date.now();
    while (summary.pagesProcessed < budget && cursor.phase !== "complete") {
      if (Date.now() - started > 150_000) break;
      if (cursor.requests >= AVIATION_MAX_REQUESTS)
        return yield* new AviationProviderError({
          operation: "run budget",
          cause: "650 native GET limit reached before terminal closure",
        });
      const current: AviationProgress = cursor;
      const url = yield* attempt("next native control", () => nextUrl(current));
      const page = yield* fetchAviationPage(url, gate).pipe(
        sharedProviderHostTurn(url),
        ProviderChunkClock.unlessDeferred(summary.pagesProcessed > 0),
      );
      if (Option.isNone(page)) break;
      const raw = page.value;
      const advanced: AviationProgress = yield* attempt(
        "native control " + url,
        (): AviationProgress => advance(current, raw),
      );
      summary.pagesProcessed++;
      if (
        advanced.phase === "closing" &&
        advanced.closing === aviationClosingControls(advanced).length
      ) {
        const snapshot = yield* attempt("complete native union", () => {
          const snapshot = aviationSnapshot(
            advanced.makes,
            advanced.pages,
            advanced.arrivals,
          );
          validateAviationSnapshot(snapshot);
          return snapshot;
        });
        // Capture disjoint terminal accounting before invoking caller-owned code.
        summary.accounting = { ...snapshot.accounting };
        summary.count = snapshot.vehicles.length;
        summary.observedVins = [...snapshot.observedVins];
        const census = yield* attempt("close model census", () =>
          aviationCensus(advanced),
        );
        summary.warnings = [
          ...summary.warnings,
          "Aviation preserved required identity rejects and quarantined every conflicting VIN occurrence. Published badge count discrepancies remain raw observations; optional metadata is nullable.",
          "Aviation " + ModelCensus.summary(aviationCensusPlan(advanced)),
        ];
        if (options.onYards) yield* options.onYards([{ ...AVIATION_YARD }]);
        yield* options.onBatch(
          snapshot.vehicles.map((vehicle) => ({ ...vehicle })),
        );
        cursor = {
          source: "aviation",
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
    } satisfies AviationStreamResult;
  }).pipe(
    ProviderChunkClock.deadline({
      duration: "3 minutes",
      onTimeout: () =>
        new AviationProviderError({
          operation: "chunk deadline",
          cause:
            "Three-minute limit exceeded; retain the last validated checkpoint",
        }),
    }),
  );
}

export function streamAviationInventory<E, R>(options: AviationOptions<E, R>) {
  // Padding the complete body on both success and failure also bounds starts
  // across serialized chunks whose local limiter would otherwise be reset.
  const gate: ProviderRequestGate = (request) =>
    request.pipe(Effect.ensuring(Effect.sleep("1600 millis")));
  return streamAviationInventoryWithRequestGate(options, gate);
}
