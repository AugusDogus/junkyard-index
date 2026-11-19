import { ingestionValidation } from "./ingestion-validation";
import { Effect, Option } from "effect";
import { OemProviderError, readOemPage } from "./oem-client";
import { OEM_ARRIVALS, OEM_MAKES } from "./oem-html";
import {
  OemCursor,
  OemCursorSchema,
  oemClosingControls,
  oemHash,
  oemModels,
  OEM_MAX_BODY_BYTES,
  OEM_MAX_REQUESTS,
  OEM_MAX_TOTAL_BYTES,
  type OemState,
} from "./oem-cursor";
import {
  oemControlUrl,
  parseOemDirectory,
  parseOemDonors,
  type OemPage,
} from "./oem-parser";
import { OemSnapshot } from "./oem-snapshot";
import {
  OemLocationSchema,
  transformOemCandidate,
  type OemLocation,
  type OemCanonicalVehicle,
} from "./oem-transform";
import type { ConnectorChunkAccounting } from "./connector-chunk";
import { assessOemRecord } from "./oem-record";
import { ProviderChunkClock } from "./provider-chunk-clock";
import { sharedProviderHostTurn } from "./shared-provider-host";

export interface OemOptions<E, R> {
  startCursor?: unknown;
  maxPages?: number;
  location: OemLocation;
  minimumUniqueInventory: number;
  previousUniqueInventory: number | null;
  readPage: (url: string) => Effect.Effect<string, OemProviderError>;
  onBatch: (vehicles: OemCanonicalVehicle[]) => Effect.Effect<void, E, R>;
}
const attempt = <A>(operation: string, run: () => A) =>
  ingestionValidation({
    try: run,
    catch: (cause) => new OemProviderError({ operation, cause }),
  });
const same = (expected: unknown, actual: unknown) => {
  if (oemHash(expected) !== oemHash(actual))
    throw new Error(
      "Closing OEM native graph or donor identity changed; restart a complete capture after reviewing drift",
    );
};
const identity = (page: OemPage) => ({
  sourceUrl: page.sourceUrl,
  nativeEmpty: page.nativeEmpty,
  records: page.records.map((r) => ({
    sourceUrl: r.sourceUrl,
    context: r.context,
    ordinal: r.ordinal,
    cardId: r.cardId,
    destinations: r.destinations,
    fields: r.fields.filter((f) =>
      ["year", "make/model", "vin", "stock"].includes(f.label),
    ),
  })),
});
function reconcileClosing(
  expected: OemPage,
  actual: OemPage,
  makes: readonly string[],
): OemPage {
  same(identity(expected), identity(actual));
  if (
    actual.records.some(
      (record) => assessOemRecord(record, makes).ownershipAlerts.length,
    )
  )
    throw new Error(
      "OEM closing donor gained an unresolved foreign supplier assertion",
    );
  return {
    ...expected,
    records: expected.records.map((record, index) => {
      const current = actual.records[index];
      if (!current) throw new Error("OEM closing donor ordinal is missing");
      return {
        ...record,
        fields: record.fields.filter((field) =>
          current.fields.some(
            (value) =>
              value.label === field.label && value.value === field.value,
          ),
        ),
        images: record.images.filter((image) => current.images.includes(image)),
      };
    }),
  };
}
export function oemNextUrl(
  state: Exclude<OemState, { phase: "complete" }>,
): string {
  if (state.phase === "arrivals") return OEM_ARRIVALS;
  if (state.phase === "directory") return OEM_MAKES;
  if (state.phase === "menus") {
    const make = state.makes[state.menus.length];
    if (make) return oemControlUrl(make, 2);
  } else if (state.phase === "models") {
    const entry = oemModels(state.menus)[state.pages.length];
    if (entry) return oemControlUrl(entry.model, 3);
  } else {
    const entry = oemClosingControls(state)[state.closing];
    if (entry) return entry.url;
  }
  throw new Error("OEM checkpoint has no next published native control");
}
export function oemAdvance(input: OemCursor, raw: string): OemCursor {
  const cursor = OemCursorSchema.parse(input),
    state = cursor.state;
  if (state.phase === "complete")
    throw new Error("Terminal OEM checkpoint cannot consume another response");
  const bytes = Buffer.byteLength(raw);
  if (!bytes || bytes > OEM_MAX_BODY_BYTES)
    throw new Error("OEM document is empty or exceeds 4 MiB");
  let next: OemState;
  if (state.phase === "arrivals")
    next = {
      phase: "directory",
      arrivals: parseOemDonors(raw, { kind: "arrivals" }),
    };
  else if (state.phase === "directory")
    next = {
      ...state,
      phase: "menus",
      makes: parseOemDirectory(raw, { kind: "makes" }),
      menus: [],
    };
  else if (state.phase === "menus") {
    const make = state.makes[state.menus.length];
    if (!make) throw new Error("OEM native make context is missing");
    const menus = [
      ...state.menus,
      { make, models: parseOemDirectory(raw, { kind: "models", make }) },
    ];
    next =
      menus.length === state.makes.length
        ? { ...state, phase: "models", menus, pages: [] }
        : { ...state, menus };
  } else if (state.phase === "models") {
    const entry = oemModels(state.menus)[state.pages.length];
    if (!entry) throw new Error("OEM native model context is missing");
    const pages = [
      ...state.pages,
      parseOemDonors(raw, { kind: "model", ...entry }),
    ];
    next =
      pages.length === oemModels(state.menus).length
        ? { ...state, phase: "closing", pages, closing: 0 }
        : { ...state, pages };
  } else {
    const control = oemClosingControls(state)[state.closing];
    if (!control) throw new Error("OEM native closing context is missing");
    let reconciled = state;
    if (control.kind === "arrivals")
      reconciled = {
        ...state,
        arrivals: reconcileClosing(
          state.arrivals,
          parseOemDonors(raw, { kind: "arrivals" }),
          state.makes.map((make) => make.label),
        ),
      };
    else if (control.kind === "makes")
      same(state.makes, parseOemDirectory(raw, { kind: "makes" }));
    else if (control.kind === "models")
      same(
        state.menus[control.index]?.models,
        parseOemDirectory(raw, { kind: "models", make: control.make }),
      );
    else {
      const expected = state.pages[control.index];
      if (!expected) throw new Error("OEM closing model binding is missing");
      const page = reconcileClosing(
        expected,
        parseOemDonors(raw, {
          kind: "model",
          make: control.make,
          model: control.model,
        }),
        state.makes.map((make) => make.label),
      );
      reconciled = {
        ...state,
        pages: state.pages.map((value, index) =>
          index === control.index ? page : value,
        ),
      };
    }
    next = { ...reconciled, closing: state.closing + 1 };
  }
  return OemCursor.checkpoint({
    ...cursor,
    requests: cursor.requests + 1,
    bytes: cursor.bytes + bytes,
    state: next,
  });
}
/** Complete validated batch only. Partial checkpoints never emit inventory. */
export function streamOemInventory<E, R>(options: OemOptions<E, R>) {
  return Effect.gen(function* () {
    const budget = options.maxPages ?? 8;
    const location = yield* attempt("yard location", () =>
      OemLocationSchema.parse(options.location),
    );
    if (
      !Number.isSafeInteger(budget) ||
      budget < 1 ||
      budget > 8 ||
      !Number.isSafeInteger(options.minimumUniqueInventory) ||
      options.minimumUniqueInventory < 1 ||
      (options.previousUniqueInventory !== null &&
        (!Number.isSafeInteger(options.previousUniqueInventory) ||
          options.previousUniqueInventory < 0))
    )
      return yield* Effect.fail(
        new OemProviderError({
          operation: "request budget",
          cause:
            "Use an integer request budget from 1 through 8, a positive qualification floor and a nonnegative previous complete count",
        }),
      );
    let cursor = yield* attempt("checkpoint", () =>
      OemCursorSchema.parse(options.startCursor ?? OemCursor.initial()),
    );
    let pagesProcessed = 0;
    const empty: ConnectorChunkAccounting = {
      recordsProcessed: 0,
      recordsRejected: 0,
      recordsExcluded: 0,
      duplicateVehicles: 0,
    };
    while (cursor.state.phase !== "complete") {
      const state = cursor.state;
      if (
        state.phase === "closing" &&
        state.closing === oemClosingControls(state).length
      ) {
        const snapshot = yield* attempt("complete-source quality", () => {
          const result = OemSnapshot.create(
            [state.arrivals, ...state.pages],
            state.makes.map((m) => m.label),
          );
          const validation = OemSnapshot.validate(result, options);
          if (!validation.ok) throw new Error(validation.reasons.join("; "));
          return result;
        });
        const terminal = OemCursor.checkpoint({
          ...cursor,
          state: { phase: "complete" },
        });
        yield* options.onBatch(
          snapshot.vehicles.map((v) => transformOemCandidate(v, location)),
        );
        return {
          source: "oem" as const,
          status: "complete" as const,
          cursor: terminal,
          count: snapshot.vehicles.length,
          pagesProcessed,
          accounting: snapshot.accounting,
          observedVins: snapshot.observedVins,
          errors: [],
          warnings: snapshot.accounting.recordsRejected
            ? [
                "OEM retains native required rejects and global identity conflicts. Optional metadata remains nullable.",
              ]
            : [],
        };
      }
      if (pagesProcessed >= budget) break;
      if (
        cursor.requests >= OEM_MAX_REQUESTS ||
        cursor.bytes > OEM_MAX_TOTAL_BYTES - OEM_MAX_BODY_BYTES
      )
        return yield* Effect.fail(
          new OemProviderError({
            operation: "whole-run bound",
            cause: "Native graph is incomplete at the request or byte limit",
          }),
        );
      const url = yield* attempt("next native control", () =>
        oemNextUrl(state),
      );
      const page = yield* options
        .readPage(url)
        .pipe(
          sharedProviderHostTurn(url),
          ProviderChunkClock.unlessDeferred(pagesProcessed > 0),
        );
      if (Option.isNone(page)) break;
      const raw = page.value;
      cursor = yield* attempt("native transition", () =>
        oemAdvance(cursor, raw),
      );
      pagesProcessed++;
    }
    return {
      source: "oem" as const,
      status:
        cursor.state.phase === "complete"
          ? ("complete" as const)
          : ("paused" as const),
      cursor,
      count: 0,
      pagesProcessed,
      accounting: empty,
      observedVins: [],
      errors: [],
      warnings: [],
    };
  }).pipe(
    ProviderChunkClock.deadline({
      duration: "3 minutes",
      onTimeout: () =>
        new OemProviderError({
          operation: "chunk deadline",
          cause:
            "Three-minute chunk deadline exceeded; retain the prior validated checkpoint",
        }),
    }),
  );
}
/** Live-capable only when explicitly called. This does not register or enable OEM. */
export function streamOemInventoryFromProvider<E, R>(
  options: Omit<OemOptions<E, R>, "readPage">,
) {
  return streamOemInventory({ ...options, readPage: readOemPage });
}
