import { ingestionValidation } from "./ingestion-validation";
import { Clock, Effect, Option, RateLimiter } from "effect";
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
} from "./pickapartva-parser";
import {
  PICKAPARTVA_RECOVERY_LIFETIME_MS,
  PickapartvaRecovery,
} from "./pickapartva-recovery";
import {
  buildPickapartvaSnapshot,
  pickapartvaPrefix,
  pickapartvaTies,
} from "./pickapartva-snapshot";
import type { PickapartvaCanonicalVehicle } from "./pickapartva-transform";
import {
  PICKAPARTVA_CATALOG,
  PICKAPARTVA_MAX_PAGES,
  PICKAPARTVA_YARDS,
  pickapartvaSearchHref,
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
/** Every catalog page and three closing reads. Set-date searches run in their
 * own chunks. */
const PICKAPARTVA_MAX_REQUESTS = PICKAPARTVA_MAX_PAGES + 3;
/** Turns estimate 8.5 s per request (a 5 s answer plus the URG gap), so the
 * census reserves 153 s and a turn is still granted after the two-minute
 * queue waits seen at 07:00. Measured reads take longer: about 14 s per
 * catalog page at November 19, 2026 latency (11 s on November 12, 10 to 21 s
 * on November 24) and 5 s per edge-cached closing read, about 225 s. A turn
 * that waited long reaches the chunk horizon first and the chunk is deferred
 * whole; neither advances a checkpoint. Set-date searches cost about 10 s
 * each, so a census with six tie dates (November 24) cannot also run them
 * inside the five-minute work limit. */
const PICKAPARTVA_TURN_REQUESTS = PICKAPARTVA_MAX_REQUESTS;
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

/**
 * Start no new set-date search after this much of the five-minute chunk
 * limit. The remainder covers a shared host slot wait plus one request's
 * 25-second limit and its 1.6-second spacing. Each search takes its own
 * shared host turn, about 10 s of work.
 */
export const PICKAPARTVA_SEARCH_CHUNK_SOFT_MS = 180_000;

/**
 * Runs the pending set-date searches of each recovery in order, one shared
 * host turn each, so a recovery never has to fit one chunk. Returns the
 * advanced `searches` checkpoint when the chunk ends: after the soft stop, a
 * deferred turn or the last pending search. A failed search discards the
 * chunk's progress.
 */
function searchPickapartvaRecoveries(
  recoveries: readonly PickapartvaRecovery[],
  gate: ProviderRequestGate,
) {
  return Effect.gen(function* () {
    const started = yield* Clock.currentTimeMillis;
    let next = [...recoveries];
    let advanced = false;
    while (true) {
      const index = next.findIndex(
        (recovery) => !PickapartvaRecovery.resolved(recovery),
      );
      const recovery = next[index];
      const step = recovery?.pending[0];
      if (recovery === undefined || step === undefined) break;
      // Always make progress, then checkpoint before the hard chunk limit.
      if (
        advanced &&
        (yield* Clock.currentTimeMillis) - started >=
          PICKAPARTVA_SEARCH_CHUNK_SOFT_MS
      )
        break;
      const operation = `set-date search ${recovery.date} ${step.id} ${step.make}`;
      const url = pickapartvaSearchHref(recovery.date, step.id, step.make);
      if (url === null)
        return yield* failure(
          operation,
          "The pending search is outside the verified set-date search contract",
        );
      const read = yield* fetchPickapartvaPage(url, gate).pipe(
        sharedProviderHostTurn(url),
        ProviderChunkClock.unlessDeferred(advanced),
      );
      if (Option.isNone(read)) break;
      const recorded = yield* attempt(operation, () =>
        PickapartvaRecovery.record(
          recovery,
          url,
          parsePickapartvaSearch(read.value, recovery.date, step.id, step.make),
        ),
      );
      next = next.map((entry, position) =>
        position === index ? recorded : entry,
      );
      advanced = true;
    }
    return yield* attempt("set-date recovery checkpoint", () =>
      PickapartvaCursorSchema.parse({
        source: "pickapartva",
        phase: "searches",
        recoveries: next,
      }),
    );
  });
}

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
    const stored =
      parsed.data.phase === "searches" || parsed.data.phase === "pages"
        ? parsed.data.recoveries
        : [];
    if (
      parsed.data.phase === "searches" &&
      !stored.every(PickapartvaRecovery.resolved)
    )
      return {
        ...summary,
        status: "paused",
        cursor: yield* searchPickapartvaRecoveries(stored, gate),
      } satisfies PickapartvaStreamResult;
    // The census is atomic: emitting any page depends on every later page, the
    // recovered tie donors and the closing reads, so the whole crawl is one
    // shared host turn. It only fetches and validates; nothing here touches
    // chunk state, so a deferred turn discards it whole.
    const census = yield* Effect.gen(function* () {
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
      // tied date can repeat while another of that date is never shown. A
      // saved recovery still answers for a tie this catalog shows the same
      // way; any other tie is planned again from this read.
      const ties = yield* attempt("set-date ties", () =>
        pickapartvaTies(pages),
      );
      const now = yield* Clock.currentTimeMillis;
      const recoveries = ties.map(
        (tie) =>
          stored.find(
            (recovery) =>
              PickapartvaRecovery.matches(recovery, tie) &&
              PickapartvaRecovery.resolved(recovery) &&
              PickapartvaRecovery.fresh(recovery, now),
          ) ?? PickapartvaRecovery.plan(tie, now),
      );
      // The searches run in later chunks, so this census stops here without
      // its closing reads, and the next one reads the catalog again.
      if (!recoveries.every(PickapartvaRecovery.resolved))
        return { status: "searches", recoveries } as const;
      const snapshot = yield* attempt("complete global census", () =>
        buildPickapartvaSnapshot(pages, recoveries),
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
      return { status: "census", pages, snapshot, recoveries } as const;
    }).pipe(
      sharedProviderHostTurn(PICKAPARTVA_CATALOG, PICKAPARTVA_TURN_REQUESTS),
    );
    if (census.status === "searches") {
      // A resumed emission was checkpointed against recoveries that answered
      // for the census, so needing new searches means the census changed or
      // its searches outlived their lifetime.
      if (parsed.data.phase === "pages")
        return yield* failure(
          "resume snapshot",
          `The checkpointed census's set-date searches no longer answer for the catalog's repeated Set Dates or are older than ${PICKAPARTVA_RECOVERY_LIFETIME_MS / 60_000} minutes. Restart the source from the start cursor`,
        );
      const cursor = yield* attempt("set-date recovery checkpoint", () =>
        PickapartvaCursorSchema.parse({
          source: "pickapartva",
          phase: "searches",
          recoveries: census.recoveries,
        }),
      );
      return {
        ...summary,
        status: "paused",
        cursor,
      } satisfies PickapartvaStreamResult;
    }
    const { pages, snapshot } = census;
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
              recoveries: census.recoveries,
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
    // Measured reads put this census at about 225 s of provider work (see
    // PICKAPARTVA_TURN_REQUESTS). A census past five minutes fails here unless
    // its turn reached the chunk horizon first.
    ProviderChunkClock.deadline({
      duration: "5 minutes",
      onTimeout: () =>
        failure(
          "chunk budget",
          "Five-minute provider work limit exceeded before the catalog and closing reads or the set-date searches finished. No checkpoint advanced and previous inventory is preserved. Check native catalog latency before retrying",
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
