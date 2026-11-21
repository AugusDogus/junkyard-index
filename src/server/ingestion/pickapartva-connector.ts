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
  parsePickapartvaSearch,
  type PickapartvaPage,
  type PickapartvaSearchPage,
} from "./pickapartva-parser";
import {
  buildPickapartvaSnapshot,
  pickapartvaPrefix,
  pickapartvaTieDates,
} from "./pickapartva-snapshot";
import type { PickapartvaCanonicalVehicle } from "./pickapartva-transform";
import {
  PICKAPARTVA_CATALOG,
  PICKAPARTVA_MAX_PAGES,
  PICKAPARTVA_MAX_TIE_SEARCHES,
  PICKAPARTVA_PAGE_SIZE,
  PICKAPARTVA_YARD_CODES,
  PICKAPARTVA_YARDS,
  pickapartvaSearchHref,
  type PickapartvaSearchScope,
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
/** Every catalog page, for each page boundary one search plus one per yard
 * when that search is capped, and three closing reads. */
const PICKAPARTVA_MAX_REQUESTS =
  PICKAPARTVA_MAX_PAGES +
  PICKAPARTVA_MAX_TIE_SEARCHES * (1 + PICKAPARTVA_YARD_CODES.length) +
  3;
/** The turn estimate reserves the six set-date searches the November 12, 2026
 * census needed. Turns estimate 8.5 s per request (a 5 s answer plus the URG
 * gap), so this reserves 204 s and a turn is still granted after the two
 * minute queue waits seen at 07:00; reserving more would not be. Measured
 * reads take longer: about 14 s per catalog page at November 19, 2026 latency
 * (11 s on November 12), 10 s per search and 5 s per edge-cached closing read,
 * about 286 s for this census. A date set in bulk past the 500-card search cap
 * (2026-11-18, about 580 donors) costs two more yard searches, about 20 s.
 * A turn that waited long reaches the chunk horizon first and the chunk is
 * deferred whole. A turn that waited under 40 s reaches the five-minute work
 * limit first, which fails the chunk once a census needs more than about 7
 * searches (12 at November 12 latency). Neither advances a checkpoint. */
const PICKAPARTVA_TURN_REQUESTS = PICKAPARTVA_MAX_PAGES + 6 + 3;
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
    // The census is atomic: emitting any page depends on every later page, the
    // set-date searches and the closing reads, so the whole crawl is one
    // shared host turn. It only fetches and validates; nothing here touches
    // chunk state, so a deferred turn discards it whole.
    const { pages, snapshot } = yield* Effect.gen(function* () {
      let requests = 0;
      const read = (url: string) =>
        Effect.gen(function* () {
          if (++requests > PICKAPARTVA_MAX_REQUESTS)
            return yield* failure(
              "request budget",
              `${PICKAPARTVA_MAX_REQUESTS}-request chunk limit exceeded`,
            );
          return yield* fetchPickapartvaPage(url, gate);
        });
      const fetchPage = (url: string, ordinal: number) =>
        Effect.flatMap(read(url), (raw) =>
          attempt("native page " + ordinal, () =>
            parsePickapartvaPage(raw, ordinal),
          ),
        );
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
      // Pages split Set Date ties differently at each offset, so a donor of a
      // tied date can repeat while another of that date is never shown. Each
      // repeated date's native search lists all its donors on one page.
      const searches: Array<{ url: string; page: PickapartvaSearchPage }> = [];
      const dates = yield* attempt("set-date ties", () =>
        pickapartvaTieDates(pages),
      );
      const search = (date: string, id: PickapartvaSearchScope) =>
        Effect.gen(function* () {
          const url = pickapartvaSearchHref(date, id);
          if (url === null)
            return yield* failure(
              "set-date search " + date,
              "Repeated catalog donors carry an invalid Set Date",
            );
          const raw = yield* read(url);
          const result = yield* attempt("set-date search " + date, () =>
            parsePickapartvaSearch(raw, date, id),
          );
          return { url, result };
        });
      for (const date of dates) {
        const all = yield* search(date, "ANY");
        if (all.result.status === "complete") {
          searches.push({ url: all.url, page: all.result.page });
          continue;
        }
        // One search page holds at most 500 cards, so a date set in bulk is
        // read one physical yard at a time.
        for (const id of PICKAPARTVA_YARD_CODES) {
          const yard = yield* search(date, id);
          if (yard.result.status === "capped")
            return yield* failure(
              "set-date search " + date,
              `Pick-A-Part VA set-date search for ${date} in ${id} returned ${yard.result.cards} cards; completeness is only known for 1 to ${PICKAPARTVA_PAGE_SIZE - 1} matched donor cards per yard`,
            );
          searches.push({ url: yard.url, page: yard.result.page });
        }
      }
      const snapshot = yield* attempt("complete global census", () =>
        buildPickapartvaSnapshot(pages, searches),
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
      sharedProviderHostTurn(PICKAPARTVA_CATALOG, PICKAPARTVA_TURN_REQUESTS),
    );
    const start = parsed.data.phase === "pages" ? parsed.data.nextPage : 1;
    const previous = pickapartvaPrefix(snapshot, start);
    if (parsed.data.phase === "pages") {
      const cursor = parsed.data;
      if (
        cursor.snapshotHash !== snapshot.hash ||
        cursor.lastPage !== pages.length ||
        JSON.stringify(cursor.searches) !== JSON.stringify(snapshot.searches) ||
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
              searches: snapshot.searches,
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
    // Measured reads put this census at about 286 s of provider work (see
    // PICKAPARTVA_TURN_REQUESTS). A census past five minutes fails here unless
    // its turn waited over 40 s and reached the chunk horizon first.
    ProviderChunkClock.deadline({
      duration: "5 minutes",
      onTimeout: () =>
        failure(
          "chunk budget",
          "Five-minute provider work limit exceeded before the catalog, set-date searches and closing reads finished. No checkpoint advanced and previous inventory is preserved. Check native latency and the number of repeated Set Dates before retrying",
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
