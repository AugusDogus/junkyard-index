import {
  ingestionValidation,
  transientRejection,
} from "./ingestion-validation";
import { Effect } from "effect";
import type { Yard } from "~/lib/yard";
import type { ProviderRequestGate } from "./provider-http-client";
import {
  fetchHeavyTruckPartsPage,
  HTP_TEXT_DECODING,
} from "./heavytruckparts-client";
import {
  HeavytruckpartsCursor,
  htpNextFill,
  htpNextPage,
  type HtpCursor,
} from "./heavytruckparts-cursor";
import {
  HTP_SUPPLIERS,
  htpStoreUrl,
  htpCatalogUrl,
  HTP_MAKE_SLUG,
  htpYearMakeUrl,
  htpYearUrl,
} from "./heavytruckparts-yard-metadata";
import {
  parseHtpCatalog,
  parseHtpStore,
  parseHtpYearFill,
} from "./heavytruckparts-catalog";
import { htpSnapshot, type HtpVehicle } from "./heavytruckparts-snapshot";
import { HtpCensusDrift } from "./heavytruckparts-census";

export class HeavytruckpartsProviderError extends Error {
  readonly tag = "HeavytruckpartsProviderError";
  constructor(
    readonly operation: string,
    cause: unknown,
  ) {
    super(
      `HTP ${operation}: ${cause instanceof Error ? cause.message : String(cause)}. ${
        cause instanceof HtpCensusDrift
          ? "The catalog changed while it was read. Prior inventory remains published, and the source retries with a fresh census after its usual delay if daily attempts remain, otherwise on its next daily run."
          : "Prior inventory and checkpoint remain preserved. Inspect saved evidence before restarting."
      }`,
      { cause },
    );
  }
}
const attempt = <A>(operation: string, run: () => A) =>
  ingestionValidation({
    try: run,
    catch: (cause) => {
      const error = new HeavytruckpartsProviderError(operation, cause);
      return cause instanceof HtpCensusDrift
        ? transientRejection(error)
        : error;
    },
  });
const pass: ProviderRequestGate = (request) => request;
export function fetchHtpPage(url: string, gate: ProviderRequestGate = pass) {
  const year = /[?&]year_start=(\d{4})&/.exec(url)?.[1];
  const make =
    /^https:\/\/www\.heavytruckparts\.net\/search\/([^/?]+)\/Any\//.exec(
      url,
    )?.[1];
  const allowed = HTP_SUPPLIERS.some(
    (s) =>
      url === htpStoreUrl(s) ||
      (year !== undefined &&
        make !== undefined &&
        make !== "Any" &&
        HTP_MAKE_SLUG.test(make) &&
        url === htpYearMakeUrl(s, year, make)) ||
      (["DESC", "ASC"] as const).some(
        (direction) =>
          Array.from({ length: 80 }, (_, i) =>
            htpCatalogUrl(s, direction, i + 1),
          ).includes(url) ||
          (year !== undefined && url === htpYearUrl(s, year, direction, 1)),
      ),
  );
  if (!allowed)
    return Effect.fail(
      new HeavytruckpartsProviderError(
        "destination",
        "URL is outside configured supplier/store controls",
      ),
    );
  return fetchHeavyTruckPartsPage(url, gate, "HTP", HTP_TEXT_DECODING).pipe(
    Effect.mapError((cause) => new HeavytruckpartsProviderError(url, cause)),
  );
}
export function htpAdvance(cursor: HtpCursor, raw: string): HtpCursor {
  const s = HTP_SUPPLIERS[cursor.completed.length];
  if (!s) throw new Error("HTP census has no remaining supplier");
  const { checksum: _checksum, ...state } = cursor;
  void _checksum;
  const bytes = Buffer.byteLength(raw);
  if (bytes < 1 || bytes > 2 * 1024 * 1024)
    throw new Error("HTP response is empty or exceeds 2 MiB");
  const next = {
    ...state,
    requests: cursor.requests + 1,
    bytes: cursor.bytes + bytes,
    startedAt: cursor.startedAt || Date.now(),
  };
  switch (cursor.phase) {
    case "store-opening":
      return HeavytruckpartsCursor.checkpoint({
        ...next,
        phase: "catalog",
        total: parseHtpStore(raw, s),
        pages: [],
      });
    case "catalog": {
      const control = htpNextPage(cursor.pages, cursor.total);
      if (!control) throw new Error("HTP catalog frontier exhausted");
      const pages = [
        ...cursor.pages,
        parseHtpCatalog(raw, s, control.direction, control.page, cursor.total),
      ];
      if (htpNextPage(pages, cursor.total))
        return HeavytruckpartsCursor.checkpoint({ ...next, pages });
      return HeavytruckpartsCursor.checkpoint({
        ...next,
        pages,
        fills: [],
        phase: htpNextFill(s, pages, [], cursor.total)
          ? "year-fill"
          : "store-closing",
      });
    }
    case "year-fill": {
      const control = htpNextFill(s, cursor.pages, cursor.fills, cursor.total);
      if (!control) throw new Error("HTP year-fill frontier exhausted");
      const fills = [...cursor.fills, parseHtpYearFill(raw, s, control)];
      return HeavytruckpartsCursor.checkpoint({
        ...next,
        fills,
        phase: htpNextFill(s, cursor.pages, fills, cursor.total)
          ? "year-fill"
          : "store-closing",
      });
    }
    case "store-closing": {
      if (parseHtpStore(raw, s) !== cursor.total)
        throw new HtpCensusDrift(`HTP ${s.code} closing store count changed`);
      const completed = [
        ...cursor.completed,
        {
          code: s.code,
          total: cursor.total,
          pages: cursor.pages,
          fills: cursor.fills,
        },
      ];
      const common = {
        source: next.source,
        version: next.version,
        scope: next.scope,
        startedAt: next.startedAt,
        requests: next.requests,
        bytes: next.bytes,
        previousAcceptedCount: next.previousAcceptedCount,
      };
      return HeavytruckpartsCursor.checkpoint({
        ...common,
        completed,
        phase:
          completed.length === HTP_SUPPLIERS.length ? "ready" : "store-opening",
      });
    }
    default:
      throw new Error("HTP terminal checkpoints cannot advance");
  }
}
interface Options<E, R> {
  startCursor?: unknown;
  maxPages?: number;
  previousAcceptedCount?: number | null;
  readPage?: (
    url: string,
  ) => Effect.Effect<string, HeavytruckpartsProviderError>;
  onBatch: (vehicles: HtpVehicle[]) => Effect.Effect<void, E, R>;
  onYards?: (yards: Yard[]) => Effect.Effect<void, E, R>;
}
export function streamHeavytruckpartsInventory<E, R>(
  options: Options<E, R>,
  gate?: ProviderRequestGate,
) {
  return Effect.gen(function* () {
    const budget = options.maxPages ?? 8;
    let cursor = yield* attempt("checkpoint", () => {
      if (!Number.isSafeInteger(budget) || budget < 1 || budget > 8)
        throw new Error("Use 1-8 physical GETs per chunk");
      const value = HeavytruckpartsCursor.parse(
        options.startCursor ??
          HeavytruckpartsCursor.initial(options.previousAcceptedCount ?? null),
      );
      if (
        options.previousAcceptedCount !== undefined &&
        value.previousAcceptedCount !== options.previousAcceptedCount
      )
        throw new Error("HTP prior accepted count contradicts checkpoint");
      return value;
    });
    let pagesProcessed = 0;
    const started = Date.now();
    while (
      cursor.phase !== "ready" &&
      cursor.phase !== "complete" &&
      pagesProcessed < budget &&
      Date.now() - started < 60_000
    ) {
      const current = cursor;
      yield* attempt("run lifetime", () => {
        if (
          current.startedAt &&
          (Date.now() < current.startedAt ||
            Date.now() - current.startedAt > 3_600_000)
        )
          throw new Error(
            "One-hour census expired; restart after inspecting source",
          );
      });
      const url = yield* attempt("next native control", () =>
        HeavytruckpartsCursor.nextUrl(current),
      );
      const raw = yield* (
        options.readPage ?? ((url) => fetchHtpPage(url, gate))
      )(url);
      cursor = yield* attempt("native census " + url, () =>
        htpAdvance(current, raw),
      );
      pagesProcessed++;
    }
    const observedVins: string[] = [],
      errors: string[] = [],
      warnings: string[] = [];
    const empty = {
      source: "heavytruckparts" as const,
      cursor,
      count: 0,
      pagesProcessed,
      accounting: {
        recordsProcessed: 0,
        recordsRejected: 0,
        recordsExcluded: 0,
        duplicateVehicles: 0,
      },
      observedVins,
      errors,
      warnings,
    };
    if (cursor.phase !== "ready")
      return {
        ...empty,
        status:
          cursor.phase === "complete"
            ? ("complete" as const)
            : ("paused" as const),
      };
    const ready = cursor;
    const snapshot = yield* attempt(
      "complete supplier and source quality",
      () => {
        if (
          Date.now() < ready.startedAt ||
          Date.now() - ready.startedAt > 3_600_000
        )
          throw new Error("One-hour census expired before emission");
        return htpSnapshot(ready.completed, ready.previousAcceptedCount);
      },
    );
    if (options.onYards)
      yield* options.onYards(HTP_SUPPLIERS.map((s) => s.yard));
    yield* options.onBatch(snapshot.vehicles);
    const { checksum: _checksum, ...state } = ready;
    void _checksum;
    cursor = yield* attempt("terminal checkpoint", () =>
      HeavytruckpartsCursor.checkpoint({ ...state, phase: "complete" }),
    );
    return {
      ...empty,
      status: "complete" as const,
      cursor,
      count: snapshot.vehicles.length,
      accounting: snapshot.accounting,
      observedVins: snapshot.observedVins,
      warnings: snapshot.warnings,
    };
  }).pipe(
    Effect.timeoutFail({
      duration: "4 minutes",
      onTimeout: () =>
        new HeavytruckpartsProviderError(
          "chunk deadline",
          "Four-minute limit exceeded; retain the last validated checkpoint",
        ),
    }),
  );
}
