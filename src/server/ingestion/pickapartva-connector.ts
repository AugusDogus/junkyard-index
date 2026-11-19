import { ingestionValidation } from "./ingestion-validation";
import { Effect, RateLimiter } from "effect";
import type { ConnectorChunkResult } from "./connector-chunk";
import {
  fetchPickapartvaPage,
  PickapartvaProviderError,
} from "./pickapartva-client";
import {
  PickapartvaCursor,
  PickapartvaCursorSchema,
} from "./pickapartva-cursor";
import {
  parsePickapartvaPage,
  type PickapartvaPage,
} from "./pickapartva-parser";
import {
  buildPickapartvaSnapshot,
  pickapartvaPrefix,
} from "./pickapartva-snapshot";
import type { PickapartvaCanonicalVehicle } from "./pickapartva-transform";
import {
  PICKAPARTVA_CATALOG,
  PICKAPARTVA_MAX_PAGES,
  PICKAPARTVA_YARDS,
  type PickapartvaYard,
} from "./pickapartva-yard-metadata";
import { ProviderChunkClock } from "./provider-chunk-clock";
import type { ProviderRequestGate } from "./provider-http-client";
import { sharedProviderHostTurn } from "./shared-provider-host";

interface PickapartvaOptions<E, R> {
  startCursor?: PickapartvaCursor;
  /** Native raw-page emission partitions; the complete snapshot is checked first. */
  maxPages?: number;
  onBatch: (
    vehicles: PickapartvaCanonicalVehicle[],
  ) => Effect.Effect<void, E, R>;
  onYards?: (yards: PickapartvaYard[]) => Effect.Effect<void, E, R>;
}
export type PickapartvaStreamResult = ConnectorChunkResult<
  "pickapartva",
  PickapartvaCursor
>;
const failure = (operation: string, cause: unknown) =>
  new PickapartvaProviderError({ operation, cause });
const attempt = <A>(operation: string, run: () => A) =>
  ingestionValidation({
    try: run,
    catch: (cause) => failure(operation, cause),
  });

export function streamPickapartvaInventoryWithRequestGate<E, R>(
  options: PickapartvaOptions<E, R>,
  gate: ProviderRequestGate,
) {
  return Effect.gen(function* () {
    const parsed = PickapartvaCursorSchema.safeParse(
      options.startCursor ?? PickapartvaCursor.initial,
    );
    const maxPages = options.maxPages ?? PICKAPARTVA_MAX_PAGES;
    if (
      !parsed.success ||
      !Number.isSafeInteger(maxPages) ||
      maxPages < 1 ||
      maxPages > PICKAPARTVA_MAX_PAGES
    )
      return yield* failure(
        "checkpoint",
        "Use a validated Pick-A-Part VA cursor and 1-15 raw-page emission units",
      );
    const summary: PickapartvaStreamResult = {
      source: "pickapartva",
      status: "complete",
      cursor: { source: "pickapartva", phase: "complete" },
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
    if (parsed.data.phase === "complete") return summary;
    // The census is atomic: emitting any page depends on every later page and
    // the closing reads, so the whole crawl (up to 15 pages and 3 closing
    // reads) is one shared host turn. It only fetches and validates; nothing
    // here touches chunk state, so a deferred turn discards it whole.
    const { pages, snapshot } = yield* Effect.gen(function* () {
      let requests = 0;
      const fetchPage = (url: string, ordinal: number) =>
        Effect.gen(function* () {
          if (++requests > PICKAPARTVA_MAX_PAGES + 3)
            return yield* failure(
              "request budget",
              "18-request chunk limit exceeded",
            );
          const raw = yield* fetchPickapartvaPage(url, gate);
          return yield* attempt("native page " + ordinal, () =>
            parsePickapartvaPage(raw, ordinal),
          );
        });
      const pages: Array<{ url: string; page: PickapartvaPage }> = [];
      let nextUrl: string | null = PICKAPARTVA_CATALOG;
      while (nextUrl !== null) {
        const url: string = nextUrl;
        const page: PickapartvaPage = yield* fetchPage(url, pages.length + 1);
        pages.push({ url, page });
        if (pages[0]?.page.lastPage !== page.lastPage)
          return yield* failure(
            "page drift",
            "Published terminal page changed during enumeration",
          );
        nextUrl = page.nextUrl;
      }
      const snapshot = yield* attempt("complete global census", () =>
        buildPickapartvaSnapshot(pages),
      );
      for (const ordinal of new Set([
        1,
        Math.min(2, pages.length),
        pages.length,
      ])) {
        const opening = pages[ordinal - 1];
        if (!opening)
          return yield* failure(
            "closing control",
            "Missing opening native control",
          );
        const closing = yield* fetchPage(opening.url, ordinal);
        if (closing.hash !== opening.page.hash)
          return yield* failure(
            "closing drift",
            `Native page ${ordinal} donor fields, physical scope or continuation changed`,
          );
      }
      return { pages, snapshot };
    }).pipe(
      sharedProviderHostTurn(PICKAPARTVA_CATALOG, PICKAPARTVA_MAX_PAGES + 3),
    );
    const start = parsed.data.phase === "pages" ? parsed.data.nextPage : 1;
    const previous = pickapartvaPrefix(snapshot, start);
    if (parsed.data.phase === "pages") {
      const cursor = parsed.data;
      if (
        cursor.snapshotHash !== snapshot.hash ||
        cursor.lastPage !== pages.length ||
        cursor.receipts.some((receipt, index) => {
          const current = snapshot.receipts[index];
          return (
            current?.page !== receipt.page ||
            current.url !== receipt.url ||
            current.hash !== receipt.hash
          );
        }) ||
        cursor.processed !== previous.processed ||
        cursor.emitted !== previous.emitted ||
        cursor.rejected !== previous.rejected ||
        cursor.duplicates !== previous.duplicates
      )
        return yield* failure(
          "resume snapshot",
          "Checkpoint fingerprint, ownership or cumulative prefix counters differ from the rebuilt native census",
        );
    }
    const selected = snapshot.buckets.slice(start - 1, start - 1 + maxPages);
    const nextPage = start + selected.length;
    const counts = pickapartvaPrefix(snapshot, nextPage);
    const cursor = yield* attempt("next checkpoint", () =>
      PickapartvaCursorSchema.parse(
        nextPage > pages.length
          ? { source: "pickapartva", phase: "complete" }
          : {
              source: "pickapartva",
              phase: "pages",
              snapshotHash: snapshot.hash,
              receipts: snapshot.receipts,
              lastPage: pages.length,
              nextPage,
              ...counts,
            },
      ),
    );
    if (options.onYards)
      yield* options.onYards([
        { ...PICKAPARTVA_YARDS.TT87 },
        { ...PICKAPARTVA_YARDS.UU81 },
      ]);
    for (const bucket of selected) {
      if (bucket.vehicles.length) yield* options.onBatch([...bucket.vehicles]);
      summary.count += bucket.vehicles.length;
      summary.pagesProcessed++;
      if (summary.accounting) {
        summary.accounting.recordsProcessed +=
          bucket.accounting.recordsProcessed;
        summary.accounting.recordsRejected += bucket.accounting.recordsRejected;
        summary.accounting.duplicateVehicles +=
          bucket.accounting.duplicateVehicles;
      }
    }
    return {
      ...summary,
      cursor,
      status: cursor.phase === "complete" ? "complete" : "paused",
      observedVins: snapshot.observedVins,
      warnings:
        snapshot.observedVins.length ||
        snapshot.buckets.some((bucket) => bucket.accounting.recordsRejected > 0)
          ? [
              "Pick-A-Part VA rejected incomplete required identities; independently valid rejected VINs supply presence evidence only. Optional metadata disagreements are null.",
            ]
          : [],
    } satisfies PickapartvaStreamResult;
  }).pipe(
    ProviderChunkClock.deadline({
      duration: "3 minutes",
      onTimeout: () =>
        failure(
          "chunk budget",
          "Three-minute limit exceeded; no completed checkpoint returned",
        ),
    }),
  );
}

export function streamPickapartvaInventory<E, R>(
  options: PickapartvaOptions<E, R>,
) {
  return Effect.scoped(
    RateLimiter.make({ limit: 1, interval: "1600 millis" }).pipe(
      Effect.flatMap((limiter) => {
        // Keep the final request padded on success and failure, so a fresh limiter
        // in the next serialized durable chunk cannot reset native pacing.
        const gate: ProviderRequestGate = (request) =>
          limiter(request).pipe(Effect.ensuring(Effect.sleep("1600 millis")));
        return streamPickapartvaInventoryWithRequestGate(options, gate);
      }),
    ),
  );
}
