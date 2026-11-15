import { Effect } from "effect";
import {
  BeaversCursor,
  BeaversCursorSchema,
  type BeaversProgress,
} from "./beavers-cursor";
import {
  BeaversProviderError,
  beaversRequestGate,
  fetchBeaversPage,
  type BeaversResponse,
} from "./beavers-client";
import {
  parseBeaversCatalog,
  parseBeaversDetail,
  type BeaversCatalog,
} from "./beavers-parser";
import { beaversSnapshot, type BeaversVehicle } from "./beavers-transform";
import {
  BEAVERS_CATALOG,
  BEAVERS_YARD,
  type BeaversYard,
} from "./beavers-yard-metadata";
import type { ProviderRequestGate } from "./provider-http-client";

const attempt = <A>(operation: string, run: () => A) =>
  Effect.try({
    try: run,
    catch: (cause) => new BeaversProviderError({ operation, cause }),
  });
export function beaversNextUrl(cursor: BeaversProgress): string {
  if (cursor.phase === "catalog")
    return cursor.pages.at(-1)?.next ?? BEAVERS_CATALOG;
  if (cursor.phase === "detail") return cursor.pending;
  if (cursor.phase === "closing") {
    const page = cursor.pages[cursor.closing];
    if (!page) throw new Error("Beaver's closing page is missing");
    return page.url;
  }
  const row = cursor.pages.flatMap((page) => page.rows)[cursor.records.length];
  if (!row) throw new Error("Beaver's next published donor is missing");
  return row.url;
}
const membership = (page: BeaversCatalog) =>
  JSON.stringify({
    page: page.page,
    total: page.total,
    next: page.next,
    controls: page.controls,
    rows: page.rows.map(({ displayYear, model, vin, url }) => ({
      displayYear,
      model,
      vin,
      url,
    })),
  });
export function advanceBeavers(
  cursor: BeaversProgress,
  response: BeaversResponse,
): BeaversProgress {
  const url = beaversNextUrl(cursor);
  if (cursor.phase === "route") {
    if (response.kind !== "redirect")
      throw new Error("Beaver's native donor redirect is missing");
    return BeaversCursor.checkpoint({
      ...cursor,
      phase: "detail",
      pending: response.url,
    });
  }
  if (response.kind !== "html")
    throw new Error("Beaver's native inventory HTML is missing");
  if (cursor.phase === "catalog") {
    const page = parseBeaversCatalog(response.body, url),
      pages = [...cursor.pages, page];
    return BeaversCursor.checkpoint({
      ...cursor,
      pages,
      phase: page.next === null ? "route" : "catalog",
    });
  }
  if (cursor.phase === "detail") {
    const rows = cursor.pages.flatMap((page) => page.rows),
      row = rows[cursor.records.length];
    if (!row) throw new Error("Beaver's native donor context is missing");
    const records = [...cursor.records, parseBeaversDetail(response.body, row)];
    const state = {
      source: cursor.source,
      version: cursor.version,
      scope: cursor.scope,
      checksum: cursor.checksum,
      pages: cursor.pages,
    };
    return BeaversCursor.checkpoint(
      records.length === rows.length
        ? { ...state, phase: "closing", records, closing: 0 }
        : { ...state, phase: "route", records },
    );
  }
  const expected = cursor.pages[cursor.closing];
  if (!expected) throw new Error("Beaver's closing context is missing");
  const actual = parseBeaversCatalog(response.body, url);
  if (membership(actual) !== membership(expected))
    throw new Error(
      "Beaver's closing required donor population, order, total or continuation drifted",
    );
  const changed = new Set(
    expected.rows
      .filter((row, index) => row.stock !== actual.rows[index]?.stock)
      .map((row) => row.url),
  );
  const pages = cursor.pages.map((page) => ({
    ...page,
    rows: page.rows.map((row) =>
      changed.has(row.url) ? { ...row, stock: "" } : row,
    ),
  }));
  const records = cursor.records.map((record) =>
    changed.has(record.row.url)
      ? { ...record, stock: "", row: { ...record.row, stock: "" } }
      : record,
  );
  return BeaversCursor.checkpoint({
    ...cursor,
    pages,
    records,
    closing: cursor.closing + 1,
  });
}
interface BeaversOptions<E, R> {
  startCursor?: BeaversCursor;
  maxPages?: number;
  previousAcceptedCount?: number | null;
  onBatch: (vehicles: BeaversVehicle[]) => Effect.Effect<void, E, R>;
  onYards?: (yards: BeaversYard[]) => Effect.Effect<void, E, R>;
}
export function streamBeaversInventoryWithRequestGate<E, R>(
  options: BeaversOptions<E, R>,
  gate: ProviderRequestGate,
) {
  return Effect.gen(function* () {
    const budget = options.maxPages ?? 8;
    if (!Number.isSafeInteger(budget) || budget < 1 || budget > 32)
      return yield* new BeaversProviderError({
        operation: "chunk size",
        cause: "Use 1 to 32 native requests per durable chunk",
      });
    let cursor = yield* attempt("checkpoint", () =>
      BeaversCursorSchema.parse(options.startCursor ?? BeaversCursor.initial),
    );
    let pagesProcessed = 0;
    const empty = {
      count: 0,
      observedVins: [],
      accounting: {
        recordsProcessed: 0,
        recordsRejected: 0,
        recordsExcluded: 0,
        duplicateVehicles: 0,
      },
    };
    const started = Date.now();
    while (
      cursor.phase !== "complete" &&
      pagesProcessed < budget &&
      Date.now() - started < 150_000
    ) {
      const current: BeaversProgress = cursor;
      const url: string = yield* attempt("next literal native control", () =>
        beaversNextUrl(current),
      );
      const response = yield* fetchBeaversPage(url, gate);
      const next: BeaversProgress = yield* attempt(
        "native transition " + url,
        () => advanceBeavers(current, response),
      );
      pagesProcessed++;
      if (next.phase === "closing" && next.closing === next.pages.length) {
        const snapshot = yield* attempt("complete-source quality", () => {
          const snapshot = beaversSnapshot(
            next.records,
            options.previousAcceptedCount ?? null,
          );
          if (snapshot.errors.length)
            throw new Error(snapshot.errors.join("; "));
          return snapshot;
        });
        if (options.onYards) yield* options.onYards([{ ...BEAVERS_YARD }]);
        yield* options.onBatch(snapshot.vehicles);
        return {
          source: "beavers" as const,
          status: "complete" as const,
          cursor: {
            source: "beavers",
            version: 1,
            phase: "complete",
          } satisfies BeaversCursor,
          pagesProcessed,
          count: snapshot.vehicles.length,
          observedVins: snapshot.observedVins,
          accounting: snapshot.accounting,
          errors: [],
          warnings: [],
        };
      }
      cursor = next;
    }
    return {
      source: "beavers" as const,
      status:
        cursor.phase === "complete"
          ? ("complete" as const)
          : ("paused" as const),
      cursor,
      pagesProcessed,
      ...empty,
      errors: [],
      warnings: [],
    };
  }).pipe(
    Effect.timeoutFail({
      duration: "3 minutes",
      onTimeout: () =>
        new BeaversProviderError({
          operation: "chunk deadline",
          cause: "Three-minute limit exceeded; retain the previous checkpoint",
        }),
    }),
  );
}
export function streamBeaversInventory<E, R>(options: BeaversOptions<E, R>) {
  return streamBeaversInventoryWithRequestGate(options, beaversRequestGate);
}
