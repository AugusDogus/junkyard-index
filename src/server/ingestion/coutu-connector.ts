import { Effect } from "effect";
import type {
  ConnectorChunkAccounting,
  ConnectorChunkStatus,
} from "./connector-chunk";
import { CoutuProviderError, fetchCoutuPage } from "./coutu-client";
import {
  CoutuCursor,
  CoutuCursorSchema,
  COUTU_MAX_REQUESTS,
  coutuClosingControls,
  type CoutuProgress,
} from "./coutu-cursor";
import {
  coutuHash,
  parseCoutuHome,
  parseCoutuDirectory,
  parseCoutuModel,
} from "./coutu-parser";
import {
  coutuModels,
  coutuSnapshot,
  validateCoutuSnapshot,
} from "./coutu-snapshot";
import { COUTU_HOME, COUTU_ROOT, COUTU_ORIGIN } from "./coutu-protocol";
import { COUTU_YARD, type CoutuYard } from "./coutu-yard-metadata";
import type { CoutuCanonicalVehicle } from "./coutu-transform";
import type { ProviderRequestGate } from "./provider-http-client";

interface CoutuOptions<E, R> {
  startCursor?: CoutuCursor;
  /** One unit is one serial GET. Donor details, components and images are never fetched. */
  maxPages?: number;
  onBatch: (vehicles: CoutuCanonicalVehicle[]) => Effect.Effect<void, E, R>;
  onYards?: (yards: CoutuYard[]) => Effect.Effect<void, E, R>;
}
export interface CoutuStreamResult {
  source: "coutu";
  status: ConnectorChunkStatus;
  cursor: CoutuCursor;
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
    catch: (cause) => new CoutuProviderError({ operation, cause }),
  });
const same = (expected: unknown, actual: unknown, label: string) => {
  if (coutuHash(expected) !== coutuHash(actual))
    throw new Error(
      "Closing Coutu " +
        label +
        " changed; inspect and restart from the native home",
    );
};

function nextUrl(state: CoutuProgress): string {
  switch (state.phase) {
    case "home":
      return COUTU_HOME;
    case "directory":
      return COUTU_ROOT;
    case "makes": {
      const make = state.makes.find((m) => m.models === null);
      if (!make) throw new Error("Missing Coutu next published make");
      return COUTU_ORIGIN + make.path;
    }
    case "models": {
      const next = coutuModels(state.makes)[state.pages.length];
      if (!next) throw new Error("Missing Coutu next published model");
      return COUTU_ORIGIN + next.model.path;
    }
    case "closing": {
      const control = coutuClosingControls(state)[state.closing];
      if (!control) throw new Error("Missing Coutu closing control");
      return control.url;
    }
  }
}

function advance(state: CoutuProgress, raw: string): CoutuProgress {
  const next = { ...state, requests: state.requests + 1 };
  const names = state.makes.map((m) => m.label);
  switch (state.phase) {
    case "home":
      next.home = parseCoutuHome(raw);
      next.phase = "directory";
      break;
    case "directory":
      next.makes = parseCoutuDirectory(raw, "makes").map((make) => ({
        ...make,
        models: null,
      }));
      next.phase = "makes";
      break;
    case "makes": {
      const index = state.makes.findIndex((m) => m.models === null);
      const make = state.makes[index];
      if (!make) throw new Error("Missing Coutu published make context");
      next.makes = state.makes.map((m, i) =>
        i === index
          ? { ...m, models: parseCoutuDirectory(raw, "models", make) }
          : m,
      );
      if (next.makes.every((m) => m.models !== null)) next.phase = "models";
      break;
    }
    case "models": {
      const context = coutuModels(state.makes)[state.pages.length];
      if (!context) throw new Error("Missing Coutu published model context");
      next.pages = [
        ...state.pages,
        parseCoutuModel(raw, context.make, context.model, names),
      ];
      if (next.pages.length === coutuModels(state.makes).length)
        next.phase = "closing";
      break;
    }
    case "closing": {
      const control = coutuClosingControls(state)[state.closing];
      if (!control) throw new Error("Missing Coutu closing native context");
      switch (control.kind) {
        case "home":
          same(state.home, parseCoutuHome(raw), "native ownership");
          break;
        case "directory":
          same(
            state.makes.map(({ models: _models, ...make }) => make),
            parseCoutuDirectory(raw, "makes"),
            "make directory",
          );
          break;
        case "make":
          same(
            control.make.models,
            parseCoutuDirectory(raw, "models", control.make),
            "model directory " + control.make.label,
          );
          break;
        case "model":
          same(
            state.pages[control.index]?.hash,
            parseCoutuModel(raw, control.make, control.model, names).hash,
            "model list " + control.model.label,
          );
          break;
      }
      next.closing++;
      break;
    }
  }
  return CoutuCursor.checkpoint(next);
}

export function streamCoutuInventoryWithRequestGate<E, R>(
  options: CoutuOptions<E, R>,
  gate: ProviderRequestGate,
) {
  return Effect.gen(function* () {
    const budget = options.maxPages ?? 8;
    if (!Number.isSafeInteger(budget) || budget < 1 || budget > 8)
      return yield* new CoutuProviderError({
        operation: "request budget",
        cause: "Use an integer budget from 1 to 8 native GETs",
      });
    let cursor = yield* attempt("checkpoint", () =>
      CoutuCursorSchema.parse(options.startCursor ?? CoutuCursor.initial),
    );
    const summary: CoutuStreamResult = {
      source: "coutu",
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
      if (cursor.requests >= COUTU_MAX_REQUESTS)
        return yield* new CoutuProviderError({
          operation: "run budget",
          cause: "1024 native GET limit reached before terminal closure",
        });
      const current: CoutuProgress = cursor;
      const url = yield* attempt("next native control", () => nextUrl(current));
      const raw = yield* fetchCoutuPage(url, gate);
      const advanced: CoutuProgress = yield* attempt(
        "native control " + url,
        () => advance(current, raw),
      );
      summary.pagesProcessed++;
      if (
        advanced.phase === "closing" &&
        advanced.closing === coutuClosingControls(advanced).length
      ) {
        const snapshot = yield* attempt("complete native union", () => {
          const snapshot = coutuSnapshot(advanced.pages);
          validateCoutuSnapshot(snapshot);
          return snapshot;
        });
        summary.accounting = { ...snapshot.accounting };
        summary.count = snapshot.vehicles.length;
        summary.observedVins = [...snapshot.observedVins];
        summary.warnings = [
          "Coutu quarantined every ambiguous native identity and donor destination. Native part badges are not donor counts; optional metadata is nullable.",
        ];
        if (options.onYards) yield* options.onYards([{ ...COUTU_YARD }]);
        yield* options.onBatch(
          snapshot.vehicles.map((vehicle) => ({ ...vehicle })),
        );
        cursor = { source: "coutu", version: 1, phase: "complete" };
      } else cursor = advanced;
    }
    return {
      ...summary,
      cursor,
      status: cursor.phase === "complete" ? "complete" : "paused",
    } satisfies CoutuStreamResult;
  }).pipe(
    Effect.timeoutFail({
      duration: "3 minutes",
      onTimeout: () =>
        new CoutuProviderError({
          operation: "chunk deadline",
          cause:
            "Three-minute limit exceeded; retain the last validated checkpoint",
        }),
    }),
  );
}

export function streamCoutuInventory<E, R>(options: CoutuOptions<E, R>) {
  const gate: ProviderRequestGate = (request) =>
    request.pipe(Effect.ensuring(Effect.sleep("1600 millis")));
  return streamCoutuInventoryWithRequestGate(options, gate);
}
