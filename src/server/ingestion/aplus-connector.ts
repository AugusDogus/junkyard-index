import { ingestionValidation } from "./ingestion-validation";
import { Effect } from "effect";
import type {
  ConnectorChunkAccounting,
  ConnectorChunkStatus,
} from "./connector-chunk";
import { AplusProviderError, fetchAplusPage } from "./aplus-client";
import {
  AplusCursor,
  AplusCursorSchema,
  APLUS_MAX_REQUESTS,
  aplusClosingControls,
  type AplusProgress,
} from "./aplus-cursor";
import {
  aplusHash,
  parseAplusContact,
  parseAplusDirectory,
  parseAplusModel,
  parseAplusRoot,
} from "./aplus-parser";
import {
  aplusModels,
  aplusSnapshot,
  validateAplusSnapshot,
} from "./aplus-snapshot";
import {
  APLUS_CONTACT,
  APLUS_MAKES,
  APLUS_ORIGIN,
  APLUS_ROOT,
  APLUS_YARD,
  type AplusYard,
} from "./aplus-yard-metadata";
import type { AplusCanonicalVehicle } from "./aplus-transform";
import type { ProviderRequestGate } from "./provider-http-client";

interface AplusOptions<E, R> {
  startCursor?: AplusCursor;
  /** One unit is one serial native GET; no donor details or images are fetched. */
  maxPages?: number;
  onBatch: (vehicles: AplusCanonicalVehicle[]) => Effect.Effect<void, E, R>;
  onYards?: (yards: AplusYard[]) => Effect.Effect<void, E, R>;
}
export interface AplusStreamResult {
  source: "aplus";
  status: ConnectorChunkStatus;
  cursor: AplusCursor;
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
    catch: (cause) => new AplusProviderError({ operation, cause }),
  });
const same = (expected: unknown, actual: unknown, label: string) => {
  if (aplusHash(expected) !== aplusHash(actual))
    throw new Error(
      "Closing Aplus " +
        label +
        " changed; restart from the native root after inspection",
    );
};

function nextUrl(state: AplusProgress): string {
  switch (state.phase) {
    case "contact":
      return APLUS_CONTACT;
    case "root":
      return APLUS_ROOT;
    case "directory":
      return APLUS_MAKES;
    case "makes": {
      const make = state.makes.find((m) => m.models === null);
      if (!make) throw new Error("Missing Aplus next published make");
      return APLUS_ORIGIN + make.path;
    }
    case "models": {
      const next = aplusModels(state.makes)[state.pages.length];
      if (!next) throw new Error("Missing Aplus next published model");
      return APLUS_ORIGIN + next.model.path;
    }
    case "closing": {
      const control = aplusClosingControls(state)[state.closing];
      if (!control) throw new Error("Missing Aplus closing control");
      return control.url;
    }
  }
}

function advance(state: AplusProgress, raw: string): AplusProgress {
  const next = { ...state, requests: state.requests + 1 };
  switch (state.phase) {
    case "contact":
      next.contact = parseAplusContact(raw);
      next.phase = "root";
      break;
    case "root":
      next.arrivals = [parseAplusRoot(raw)];
      next.phase = "directory";
      break;
    case "directory":
      next.makes = parseAplusDirectory(raw, "makes").map((make) => ({
        ...make,
        models: null,
      }));
      next.phase = "makes";
      break;
    case "makes": {
      const index = state.makes.findIndex((m) => m.models === null);
      const make = state.makes[index];
      if (!make) throw new Error("Missing Aplus published make context");
      next.makes = state.makes.map((m, i) =>
        i === index
          ? { ...m, models: parseAplusDirectory(raw, "models", make) }
          : m,
      );
      if (next.makes.every((m) => m.models !== null)) next.phase = "models";
      break;
    }
    case "models": {
      const context = aplusModels(state.makes)[state.pages.length];
      if (!context) throw new Error("Missing Aplus published model context");
      next.pages = [
        ...state.pages,
        parseAplusModel(raw, context.make, context.model),
      ];
      if (next.pages.length === aplusModels(state.makes).length)
        next.phase = "closing";
      break;
    }
    case "closing": {
      const control = aplusClosingControls(state)[state.closing];
      if (!control) throw new Error("Missing Aplus closing native context");
      switch (control.kind) {
        case "contact":
          same(state.contact, parseAplusContact(raw), "official ownership");
          break;
        case "directory":
          same(
            state.makes.map(({ models: _models, ...make }) => make),
            parseAplusDirectory(raw, "makes"),
            "make directory",
          );
          break;
        case "make":
          same(
            control.make.models,
            parseAplusDirectory(raw, "models", control.make),
            "model directory " + control.make.label,
          );
          break;
        case "model":
          same(
            state.pages[control.index]?.hash,
            parseAplusModel(raw, control.make, control.model).hash,
            "model list " + control.model.label,
          );
          break;
        case "root":
          next.arrivals = [...state.arrivals, parseAplusRoot(raw)];
          break;
      }
      next.closing++;
      break;
    }
  }
  return AplusCursor.checkpoint(next);
}

/** No page starts after this point in a chunk. One page with every retry takes
 * at most 3 x (40 second deadline + 3.5 second host gap + 1.6 second gate)
 * plus 12 seconds of backoff, about 147 seconds, so a page started just before
 * the cutoff still finishes well inside the chunk deadline, with room left for
 * shared host slot waits. */
const APLUS_CHUNK_START_CUTOFF_MS = 150_000;

export function streamAplusInventoryWithRequestGate<E, R>(
  options: AplusOptions<E, R>,
  gate: ProviderRequestGate,
) {
  return Effect.gen(function* () {
    const budget = options.maxPages ?? 8;
    if (!Number.isSafeInteger(budget) || budget < 1 || budget > 8)
      return yield* new AplusProviderError({
        operation: "request budget",
        cause: "Use an integer budget from 1 to 8 native GETs",
      });
    let cursor = yield* attempt("checkpoint", () =>
      AplusCursorSchema.parse(options.startCursor ?? AplusCursor.initial),
    );
    const summary: AplusStreamResult = {
      source: "aplus",
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
      if (Date.now() - started > APLUS_CHUNK_START_CUTOFF_MS) break;
      if (cursor.requests >= APLUS_MAX_REQUESTS)
        return yield* new AplusProviderError({
          operation: "run budget",
          cause: "1024 native GET limit reached before terminal closure",
        });
      const current: AplusProgress = cursor;
      const url = yield* attempt("next native control", () => nextUrl(current));
      const raw = yield* fetchAplusPage(url, gate);
      const advanced: AplusProgress = yield* attempt(
        "native control " + url,
        (): AplusProgress => advance(current, raw),
      );
      summary.pagesProcessed++;
      if (
        advanced.phase === "closing" &&
        advanced.closing === aplusClosingControls(advanced).length
      ) {
        const snapshot = yield* attempt("complete native union", () => {
          const snapshot = aplusSnapshot(
            advanced.makes,
            advanced.pages,
            advanced.arrivals,
          );
          validateAplusSnapshot(snapshot);
          return snapshot;
        });
        // Capture disjoint terminal accounting before invoking caller-owned code.
        summary.accounting = { ...snapshot.accounting };
        summary.count = snapshot.vehicles.length;
        summary.observedVins = [...snapshot.observedVins];
        summary.warnings = [
          "Aplus preserved required identity rejects and quarantined every conflicting VIN occurrence. Published badge count discrepancies remain raw observations; optional metadata is nullable.",
        ];
        if (options.onYards) yield* options.onYards([{ ...APLUS_YARD }]);
        yield* options.onBatch(
          snapshot.vehicles.map((vehicle) => ({ ...vehicle })),
        );
        cursor = { source: "aplus", version: 1, phase: "complete" };
      } else cursor = advanced;
    }
    return {
      ...summary,
      cursor,
      status: cursor.phase === "complete" ? "complete" : "paused",
    } satisfies AplusStreamResult;
  }).pipe(
    Effect.timeoutFail({
      duration: "6 minutes",
      onTimeout: () =>
        new AplusProviderError({
          operation: "chunk deadline",
          cause:
            "Six-minute limit exceeded; retain the last validated checkpoint",
        }),
    }),
  );
}

export function streamAplusInventory<E, R>(options: AplusOptions<E, R>) {
  // Padding the complete body on both success and failure also bounds starts
  // across serialized chunks whose local limiter would otherwise be reset.
  const gate: ProviderRequestGate = (request) =>
    request.pipe(Effect.ensuring(Effect.sleep("1600 millis")));
  return streamAplusInventoryWithRequestGate(options, gate);
}
