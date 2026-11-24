import { Data, Duration, Effect, Option, RateLimiter } from "effect";
import type { ConnectorChunkResult } from "./connector-chunk";
import { Config, Database } from "./context";
import {
  DocumentTransport,
  type BrowserOpenError,
  type BrowserSessions,
} from "./document-transport";
import { KernelUsage } from "./kernel-usage";
import { normalizeCanonicalMake } from "./normalization";
import {
  ProviderChunkClock,
  type ProviderChunkWallTimeout,
} from "./provider-chunk-clock";
import type { ProviderRequestGate } from "./provider-http-client";
import {
  fetchUpullRPartsMakes,
  fetchUpullRPartsModels,
  fetchUpullRPartsVehicles,
  fetchUpullRPartsYears,
  UpullRPartsProviderError,
} from "./upullrparts-client";
import {
  UPULLRPARTS_BLOCK_RETRY_MS,
  UPULLRPARTS_MAX_BLOCK_MS,
  UpullRPartsCursor,
} from "./upullrparts-cursor";
import { loadUpullRPartsImages } from "./upullrparts-images";
import {
  checkUpullRPartsSearch,
  crawlUpullRPartsMakes,
  UPULLRPARTS_LOCATIONS,
  UPULLRPARTS_MAX_STEP_SEARCHES,
  type UpullRPartsCrawlError,
  type UpullRPartsCrawlProgress,
  type UpullRPartsResumePoint,
  type UpullRPartsSearch,
  UpullRPartsSearchBlocked,
} from "./upullrparts-make-crawl";
import {
  isUsableUpullRPartsVehicle,
  transformUpullRPartsVehicle,
  type UpullRPartsCanonicalVehicle,
} from "./upullrparts-transform";
import {
  UpullRPartsTokens,
  UpullRPartsTurnstile,
  type UpullRPartsTokenError,
} from "./upullrparts-turnstile";
import {
  findUpullRPartsYard,
  UPULLRPARTS_YARDS,
  type UpullRPartsYard,
} from "./upullrparts-yard-metadata";

export type UpullRPartsStreamResult = ConnectorChunkResult<
  "upullrparts",
  UpullRPartsCursor
>;
export const UPULLRPARTS_BATCH_SIZE = 250;

/**
 * getVehicles returns an empty list to an IP for hours once it
 * sends more than about 13 searches in a minute; directory and photo actions
 * do not count. Searches start no more often than this, 8 a minute.
 */
export const UPULLRPARTS_SEARCH_INTERVAL = Duration.millis(7_500);
/** Searches one chunk may send, both canaries included. The chunk mints a
 * token for each, plus `TOKEN_RETRIES` for searches that fail in transit. */
export const UPULLRPARTS_CHUNK_SEARCHES = 30;
const TOKEN_RETRIES = 2;
/**
 * A chunk stops starting crawl steps this long after its opening canary, or
 * earlier when less than {@link UPULLRPARTS_CHUNK_TAIL_MS} of its work limit
 * would be left, as after a slow session open.
 */
export const UPULLRPARTS_MAKE_START_BUDGET_MS = 200_000;
/** Work after the last step starts: the step itself (up to
 * {@link UPULLRPARTS_MAX_STEP_SEARCHES} paced searches and getYears), the
 * closing canary, photo lookups and callbacks. */
const UPULLRPARTS_CHUNK_TAIL_MS = 60_000;
const CHUNK_WORK_LIMIT = "5 minutes";

export class UpullRPartsStreamError extends Data.TaggedError(
  "UpullRPartsStreamError",
)<{ message: string }> {}

export interface UpullRPartsStreamOptions<E, R> {
  startCursor?: UpullRPartsCursor;
  onBatch: (
    vehicles: UpullRPartsCanonicalVehicle[],
  ) => Effect.Effect<void, E, R>;
  onYards?: (yards: UpullRPartsYard[]) => Effect.Effect<void, E, R>;
}

type SearchError =
  | UpullRPartsProviderError
  | UpullRPartsTokenError
  | BrowserOpenError;

type StreamError =
  | UpullRPartsProviderError
  | UpullRPartsCrawlError
  | UpullRPartsStreamError
  | ProviderChunkWallTimeout;

type CrawlCursor = Exclude<UpullRPartsCursor, { phase: "complete" }>;

function storeId(yard: UpullRPartsYard): number {
  return Number(yard.code.replace("UPRRP-", ""));
}

function resumePoint(cursor: CrawlCursor): UpullRPartsResumePoint {
  return cursor.phase === "split"
    ? {
        phase: "split",
        make: cursor.make,
        model: cursor.model,
        year: cursor.year,
      }
    : { phase: "crawl", afterMake: cursor.afterMake };
}

function nextCursor(
  cursor: CrawlCursor,
  progress: UpullRPartsCrawlProgress,
  storesSeen: number[],
): UpullRPartsCursor {
  const { location } = cursor;
  if (progress.status === "paused")
    return { source: "upullrparts", location, storesSeen, ...progress.resume };
  const index = UPULLRPARTS_LOCATIONS.indexOf(location);
  const next = UPULLRPARTS_LOCATIONS[index + 1];
  return next === undefined
    ? { source: "upullrparts", phase: "complete", storesSeen }
    : {
        source: "upullrparts",
        phase: "crawl",
        location: next,
        afterMake: null,
        storesSeen,
      };
}

/**
 * A blocked IP stays blocked for over an hour, and each retry opens a billed
 * browser session for its canary token, so the chunk pauses at its cursor
 * until `retryAt` instead of deferring every few minutes. The run stops once
 * the next retry would start past the block limit.
 */
function waitForBlock(
  cursor: CrawlCursor,
  blocked: UpullRPartsSearchBlocked,
  at: number,
) {
  const blockedSince = cursor.blockedSince ?? at;
  const retryAt = at + UPULLRPARTS_BLOCK_RETRY_MS;
  if (retryAt > blockedSince + UPULLRPARTS_MAX_BLOCK_MS)
    return Effect.fail(
      new UpullRPartsStreamError({
        message: `${blocked.message} Every canary since ${new Date(blockedSince).toISOString()} came back empty, and another retry would start more than ${UPULLRPARTS_MAX_BLOCK_MS / 3_600_000} hours after the first, so this run stops; prior inventory is preserved and the source retries after its usual delay. If that run is blocked too, check whether upullrparts.com lowered its search limit.`,
      }),
    );
  return Effect.succeed({
    status: "blocked" as const,
    cursor: { ...cursor, blockedSince, retryAt },
    warning: `${blocked.message} This chunk retries at ${new Date(retryAt).toISOString()} from the same cursor.`,
  });
}

/**
 * Each search spends one fresh token, then is sent no sooner than `pace`
 * allows. The token is taken before the pacing slot, so a slow token cannot
 * hold a slot that has already counted down and let the next search follow at
 * once. A search that fails in transit is sent once more with another token
 * and slot, since a token verifies once and the first may already have been
 * spent.
 */
export function makeUpullRPartsTokenSearch(
  tokens: UpullRPartsTokens,
  pace: ProviderRequestGate,
): UpullRPartsSearch<SearchError> {
  return (params) =>
    Effect.flatMap(tokens.take, (token) =>
      pace(fetchUpullRPartsVehicles(params, token)),
    ).pipe(
      Effect.retry({
        times: 1,
        while: (error) => error instanceof UpullRPartsProviderError,
      }),
    );
}

/**
 * Crawls U Pull R Parts make by make, one location at a time, sending at most
 * {@link UPULLRPARTS_CHUNK_SEARCHES} searches and starting crawl steps for up
 * to {@link UPULLRPARTS_MAKE_START_BUDGET_MS} per chunk; a chunk can pause
 * inside a split make. Vehicles are emitted only after a chunk's searches and
 * photos all succeed, so a failed chunk retries from its cursor without
 * partial output.
 */
export function streamUpullRPartsInventoryWithSearch<E, R, S>(
  options: UpullRPartsStreamOptions<E, R>,
  requestGate: ProviderRequestGate,
  search: UpullRPartsSearch<S>,
  now: () => number = Date.now,
): Effect.Effect<UpullRPartsStreamResult, StreamError | S | E, R> {
  return Effect.gen(function* () {
    const cursor = options.startCursor ?? UpullRPartsCursor.initial;
    const empty: UpullRPartsStreamResult = {
      source: "upullrparts",
      status: "complete",
      cursor,
      count: 0,
      errors: [],
      warnings: [],
      observedVins: [],
      pagesProcessed: 0,
      accounting: {
        recordsProcessed: 0,
        recordsExcluded: 0,
        recordsRejected: 0,
        duplicateVehicles: 0,
      },
    };
    if (cursor.phase === "complete") return empty;

    let sent = 0;
    const counted: UpullRPartsSearch<S> = (params) =>
      Effect.suspend(() => {
        sent += 1;
        return search(params);
      });
    const makes = yield* fetchUpullRPartsMakes(requestGate);
    const searched = yield* Effect.gen(function* () {
      // A blocked IP returns empty lists that look like makes with no stock.
      yield* checkUpullRPartsSearch(cursor.location, counted, "before");
      // Opening the session counts toward the chunk's work limit.
      const workLeft = Option.getOrElse(
        yield* ProviderChunkClock.workLeft,
        () => Infinity,
      );
      const deadline =
        now() +
        Math.min(
          UPULLRPARTS_MAKE_START_BUDGET_MS,
          workLeft - UPULLRPARTS_CHUNK_TAIL_MS,
        );
      const crawl = yield* crawlUpullRPartsMakes({
        site: cursor.location,
        makes,
        resume: resumePoint(cursor),
        search: counted,
        directory: {
          models: (make) => fetchUpullRPartsModels(make, requestGate),
          years: (make, model) =>
            fetchUpullRPartsYears(make, model, requestGate),
        },
        // A whole step and the closing canary must still fit in the budget.
        shouldContinue: () =>
          now() < deadline &&
          sent + UPULLRPARTS_MAX_STEP_SEARCHES + 1 <=
            UPULLRPARTS_CHUNK_SEARCHES,
      });
      yield* checkUpullRPartsSearch(cursor.location, counted, "after");
      return { status: "crawled", crawl } as const;
    }).pipe(
      Effect.catchIf(
        (error) => error instanceof UpullRPartsSearchBlocked,
        (blocked) => waitForBlock(cursor, blocked, now()),
      ),
    );
    if (searched.status === "blocked") {
      yield* Effect.logWarning(searched.warning);
      const result: UpullRPartsStreamResult = {
        ...empty,
        status: "paused",
        cursor: searched.cursor,
        warnings: [searched.warning],
      };
      return result;
    }
    const { crawl } = searched;

    const accounting = {
      recordsProcessed: 0,
      recordsExcluded: 0,
      recordsRejected: 0,
      duplicateVehicles: 0,
    };
    const storesSeen = new Set(cursor.storesSeen);
    const observedVins = new Set<string>();
    const unresolvedStores = new Map<number, number>();
    const seen = new Set<string>();
    const vehicles: UpullRPartsCanonicalVehicle[] = [];
    for (const result of crawl.results) {
      accounting.recordsProcessed +=
        result.vehicles.length + result.rejectedRows;
      accounting.recordsRejected += result.rejectedRows;
      for (const { record, make } of result.vehicles) {
        const yard = findUpullRPartsYard(record.Store);
        const usable = isUsableUpullRPartsVehicle(record);
        if (yard && usable) storesSeen.add(storeId(yard));
        if (!yard || yard.lat === null || yard.lng === null) {
          accounting.recordsExcluded += 1;
          const vin = record.VIN?.trim().toUpperCase();
          if (vin) observedVins.add(vin);
          unresolvedStores.set(
            record.Store,
            (unresolvedStores.get(record.Store) ?? 0) + 1,
          );
          continue;
        }
        const vehicle = transformUpullRPartsVehicle(
          record,
          yard,
          normalizeCanonicalMake(make),
        );
        if (!vehicle) {
          accounting.recordsRejected += 1;
          continue;
        }
        if (seen.has(vehicle.vin)) {
          accounting.duplicateVehicles += 1;
          continue;
        }
        seen.add(vehicle.vin);
        vehicles.push(vehicle);
      }
    }

    const next = nextCursor(cursor, crawl.progress, [...storesSeen].sort());
    if (next.phase === "complete") {
      // There is no upstream total. A known yard with no vehicles across the
      // whole crawl is not evidence that it emptied; it must not retire its
      // prior inventory.
      const missing = UPULLRPARTS_YARDS.filter(
        (yard) => !storesSeen.has(storeId(yard)),
      );
      if (missing.length > 0)
        return yield* new UpullRPartsStreamError({
          message: `U Pull R Parts crawl finished without vehicles from known yards ${missing.map((yard) => yard.code).join(", ")}. Verify their inventory on upullrparts.com before retrying; this chunk emitted no batches.`,
        });
    }

    const images = yield* loadUpullRPartsImages(
      vehicles.map((vehicle) => vehicle.stockNumber),
    );
    for (const vehicle of vehicles) {
      vehicle.imageUrl =
        vehicle.stockNumber === null
          ? null
          : (images.get(vehicle.stockNumber) ?? null);
    }
    if (
      options.onYards &&
      cursor.phase === "crawl" &&
      cursor.afterMake === null &&
      cursor.location === "1"
    )
      yield* options.onYards([...UPULLRPARTS_YARDS]);
    for (
      let offset = 0;
      offset < vehicles.length;
      offset += UPULLRPARTS_BATCH_SIZE
    ) {
      yield* options.onBatch(
        vehicles.slice(offset, offset + UPULLRPARTS_BATCH_SIZE),
      );
    }
    const warnings = [...unresolvedStores].map(
      ([store, count]) =>
        `U Pull R Parts yard ${store}: skipped ${count} vehicles because yard coordinates are unresolved. Observed VINs preserve known inventory; verify public metadata before adding this yard.`,
    );
    for (const warning of warnings) yield* Effect.logWarning(warning);
    const result: UpullRPartsStreamResult = {
      ...empty,
      status: next.phase === "complete" ? "complete" : "paused",
      cursor: next,
      count: seen.size,
      pagesProcessed: crawl.results.reduce(
        (total, result) => total + result.searches,
        0,
      ),
      accounting,
      warnings,
      observedVins: [...observedVins],
    };
    return result;
  }).pipe(
    // Waiting for the browser session lease is not provider work.
    ProviderChunkClock.deadline({
      duration: CHUNK_WORK_LIMIT,
      onTimeout: () =>
        new UpullRPartsStreamError({
          message: `U Pull R Parts chunk exceeded its ${CHUNK_WORK_LIMIT} work limit. Retry from the same cursor; this chunk emitted no checkpoint and prior inventory is preserved.`,
        }),
    }),
  );
}

// Directory lookups (getMakes, getModels, getYears) stay serial and rate limited.
export const makeUpullRPartsRequestGate = RateLimiter.make({
  limit: 1,
  interval: "1500 millis",
});

export const makeUpullRPartsSearchGate = RateLimiter.make({
  limit: 1,
  interval: UPULLRPARTS_SEARCH_INTERVAL,
});

/** Tabs of the token browser. Billing is per browser-second, and one headful
 * Kernel browser minted about 0.40 tokens a second on 2 tabs and 0.365 on 4;
 * on 6, the site served its robot check to the browser's IP (November 23,
 * 2026). */
const TOKEN_TABS = 2;

/**
 * Searches are sent natively from this process. Only Turnstile needs a
 * browser: a remote browser session under its provider's session lease mints
 * the chunk's tokens, opened by its first search and stopped once they are
 * minted or the chunk ends. `sessions` defaults to the source's headful Kernel
 * browsers on the stealth proxy (`KernelSessions.browserProfile`), metered
 * against its monthly Kernel budget (`KernelUsage.metered`): once it is spent,
 * chunks defer without opening a browser until the next month.
 */
export function streamUpullRPartsInventory<E, R>(
  options: UpullRPartsStreamOptions<E, R>,
  sessions?: BrowserSessions,
): Effect.Effect<
  UpullRPartsStreamResult,
  StreamError | SearchError | E,
  R | Config | Database
> {
  return Effect.gen(function* () {
    const requestGate = yield* makeUpullRPartsRequestGate;
    const pace = yield* makeUpullRPartsSearchGate;
    const tokens = yield* UpullRPartsTokens.make(
      UpullRPartsTurnstile.open(
        sessions ??
          KernelUsage.metered(
            DocumentTransport.kernel(
              (yield* Config).kernelApiKey,
              "upullrparts",
              "page",
            ),
            { database: yield* Database, source: "upullrparts" },
          ),
        TOKEN_TABS,
      ),
      UPULLRPARTS_CHUNK_SEARCHES + TOKEN_RETRIES,
    );
    return yield* streamUpullRPartsInventoryWithSearch(
      options,
      requestGate,
      makeUpullRPartsTokenSearch(tokens, pace),
    );
  }).pipe(Effect.scoped);
}
