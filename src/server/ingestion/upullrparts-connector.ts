import {
  Data,
  Duration,
  Effect,
  Option,
  RateLimiter,
  type Scope,
} from "effect";
import type { ConnectorChunkResult } from "./connector-chunk";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { Config, Database } from "./context";
import {
  DocumentTransport,
  type BrowserOpenError,
  type BrowserSessions,
} from "./document-transport";
import { KernelUsage } from "./kernel-usage";
import { normalizeCanonicalMake } from "./normalization";
import {
  ProviderCapacityDeferred,
  ProviderChunkClock,
  type ProviderChunkWallTimeout,
} from "./provider-chunk-clock";
import type { ProviderRequestGate } from "./provider-http-client";
import {
  fetchUpullRPartsVehicles,
  UpullRPartsProviderError,
  type UpullRPartsVehicle,
} from "./upullrparts-client";
import {
  UPULLRPARTS_BLOCK_RETRY_MS,
  UPULLRPARTS_MAX_BLOCK_MS,
  UpullRPartsCursor,
} from "./upullrparts-cursor";
import {
  checkUpullRPartsSearch,
  UPULLRPARTS_CANARY_SEARCHES,
  crawlUpullRPartsDayByMake,
  crawlUpullRPartsWindows,
  planUpullRPartsWindows,
  UPULLRPARTS_FIRST_DAY,
  UPULLRPARTS_LOCATIONS,
  UPULLRPARTS_SEARCH_LIMIT,
  UpullRPartsDay,
  type UpullRPartsCrawlError,
  type UpullRPartsSearch,
  UpullRPartsSearchBlocked,
} from "./upullrparts-date-crawl";
import { UpullRPartsHistory } from "./upullrparts-history";
import { loadUpullRPartsImages } from "./upullrparts-images";
import {
  resolveUpullRPartsMakes,
  UpullRPartsDirectory,
  UpullRPartsDirectorySchema,
  type UpullRPartsVinMakes,
} from "./upullrparts-makes";
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
import { VinDecode } from "./vin-decode";
import { vpicClient } from "./vpic-client";
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
/** The most searches one chunk sends, both canaries included. */
export const UPULLRPARTS_CHUNK_SEARCHES = 32;
/** The most one window search can take: itself, then, when empty, its
 * canary (retried once) and its one re-search. */
const WINDOW_STEP_SEARCHES = 1 + UPULLRPARTS_CANARY_SEARCHES + 1;
/** Tokens for searches that fail in transit and are sent again. */
const TOKEN_RETRIES = 2;
/**
 * A chunk stops starting window searches this long after its opening
 * canary, or earlier when less than {@link UPULLRPARTS_CHUNK_TAIL_MS} of its
 * work limit would be left, as after a slow session open.
 */
export const UPULLRPARTS_START_BUDGET_MS = 200_000;
/** Work after the last window starts: that window with its canary and
 * re-search (up to 30 s), the make searches, the closing canary (up to 15 s),
 * a VIN decode (up to 20 s), photo lookups and callbacks. */
const UPULLRPARTS_CHUNK_TAIL_MS = 90_000;
/** Day and make searches start no later than this past the window deadline,
 * so they, the closing canary and the decode stay inside the tail. */
const MAKE_SEARCH_GRACE_MS = 15_000;
export const UPULLRPARTS_CHUNK_WORK_LIMIT = "5 minutes";
const VIN_DECODE_TIMEOUT = "20 seconds";

export class UpullRPartsStreamError extends Data.TaggedError(
  "UpullRPartsStreamError",
)<{ message: string }> {}

export interface UpullRPartsStreamOptions<E, R> {
  startCursor?: UpullRPartsCursor;
  onBatch: (
    vehicles: UpullRPartsCanonicalVehicle[],
  ) => Effect.Effect<void, E, R>;
  onYards?: (yards: UpullRPartsYard[]) => Effect.Effect<void, E, R>;
  /** Reads the state a checkpoint stored at `path` (the run's make
   * directory), as the repository's snapshot store does. */
  loadState: (path: string) => Promise<unknown>;
}

/** What a chunk needs besides its options; tests replace each. */
export interface UpullRPartsChunkDeps<S> {
  /** Paces directory requests. */
  requestGate: ProviderRequestGate;
  /** A search for the enclosing scope that mints `tokens` Turnstile
   * tokens. */
  openSearch: (
    tokens: number,
  ) => Effect.Effect<UpullRPartsSearch<S>, never, Scope.Scope>;
  /** Fails when the source's Kernel spend cap is reached, before the chunk
   * reads the snapshot or plans; the browser create checks it again. */
  checkSpend: Effect.Effect<
    void,
    ProviderCapacityDeferred | UpullRPartsStreamError
  >;
  /** Yesterday's published snapshot. */
  loadHistory: Effect.Effect<UpullRPartsHistory, UpullRPartsStreamError>;
  decodeVins: UpullRPartsVinMakes;
  now?: () => number;
}

type SearchError =
  | UpullRPartsProviderError
  | UpullRPartsTokenError
  | BrowserOpenError;

type StreamError =
  | UpullRPartsProviderError
  | UpullRPartsCrawlError
  | UpullRPartsStreamError
  | ProviderCapacityDeferred
  | ProviderChunkWallTimeout;

type SearchCursor = Extract<UpullRPartsCursor, { phase: "crawl" | "split" }>;

function storeId(yard: UpullRPartsYard): number {
  return Number(yard.code.replace("UPRRP-", ""));
}

function emptyResult(cursor: UpullRPartsCursor): UpullRPartsStreamResult {
  return {
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
}

/**
 * A blocked IP stays blocked for over an hour, and each retry opens a billed
 * browser session for its canary token, so the chunk pauses at its cursor
 * until `retryAt` instead of deferring every few minutes. The run stops once
 * the next retry would start past the block limit.
 */
function waitForBlock(
  cursor: SearchCursor,
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

function loadDirectory(
  cursor: SearchCursor,
  loadState: (path: string) => Promise<unknown>,
) {
  return Effect.gen(function* () {
    const path = cursor.statePath;
    if (path === null)
      return yield* new UpullRPartsStreamError({
        message:
          "U Pull R Parts checkpoint names no stored make directory, so the run cannot resolve makes. No batches were emitted and prior published inventory is preserved; restart the run, which loads the directory again.",
      });
    const state = yield* Effect.tryPromise({
      try: () => loadState(path),
      catch: (cause) =>
        new UpullRPartsStreamError({
          message: `U Pull R Parts could not read the run's make directory at ${path}: ${String(cause)}. No batches were emitted and prior published inventory is preserved; retry the chunk, and restart the run if the snapshot is gone.`,
        }),
    });
    const parsed = UpullRPartsDirectorySchema.safeParse(state);
    if (!parsed.success)
      return yield* new UpullRPartsStreamError({
        message: `U Pull R Parts make directory at ${path} is not a valid directory (${parsed.error.issues[0]?.message ?? "unknown issue"}). No batches were emitted and prior published inventory is preserved; restart the run, which loads the directory again.`,
      });
    return parsed.data;
  });
}

/** The crawl cursor of `location` resuming at `end`, or of the next
 * location once `location` has no days left (`end` null). A paused window
 * end is always resumed, even before the first day, since the plan may start
 * its oldest window at an earlier stored day. */
function afterLocation(
  cursor: SearchCursor,
  end: string | null,
  storesSeen: number[],
): UpullRPartsCursor {
  const { today, statePath } = cursor;
  if (end !== null)
    return {
      source: "upullrparts",
      phase: "crawl",
      location: cursor.location,
      today,
      end,
      statePath,
      storesSeen,
    };
  const next =
    UPULLRPARTS_LOCATIONS[UPULLRPARTS_LOCATIONS.indexOf(cursor.location) + 1];
  return next === undefined
    ? { source: "upullrparts", phase: "complete", storesSeen }
    : {
        source: "upullrparts",
        phase: "crawl",
        location: next,
        today,
        end: today,
        statePath,
        storesSeen,
      };
}

/**
 * Loads the run's make directory, stored with this chunk's checkpoint for
 * the crawl chunks, and dates the run: every location is searched up to
 * today's UTC day.
 */
function directoryChunk<E, R>(
  options: UpullRPartsStreamOptions<E, R>,
  requestGate: ProviderRequestGate,
  now: () => number,
) {
  return Effect.gen(function* () {
    const directory = yield* UpullRPartsDirectory.load(requestGate);
    if (options.onYards) yield* options.onYards([...UPULLRPARTS_YARDS]);
    const today = UpullRPartsDay.of(now());
    const result: UpullRPartsStreamResult = {
      ...emptyResult(UpullRPartsCursor.initial),
      status: "paused",
      cursor: {
        source: "upullrparts",
        phase: "crawl",
        location: "1",
        today,
        end: today,
        statePath: null,
        storesSeen: [],
      },
      pagesProcessed: directory.makes.length + 1,
      checkpointState: directory,
    };
    return result;
  });
}

/** The vehicles a chunk found, each with its canonical make. */
interface FoundVehicle {
  record: UpullRPartsVehicle;
  make: string;
}

/**
 * One chunk at one location, both canaries included: a crawl chunk searches
 * date windows planned from the snapshot, newest first, then the makes of
 * models two makes list; a split chunk searches one full day make by make.
 */
function searchChunk<E, R, S>(
  cursor: SearchCursor,
  directory: UpullRPartsDirectory,
  options: UpullRPartsStreamOptions<E, R>,
  deps: UpullRPartsChunkDeps<S>,
  now: () => number,
): Effect.Effect<
  UpullRPartsStreamResult,
  StreamError | S | E,
  R | Scope.Scope
> {
  return Effect.gen(function* () {
    const site = cursor.location;
    yield* deps.checkSpend;
    const history = yield* deps.loadHistory;
    const windows =
      cursor.phase === "crawl"
        ? planUpullRPartsWindows({
            end: cursor.end,
            counts: history.counts[site],
            unknownFrom: history.publishedDay ?? cursor.today,
            newDayEstimate: UpullRPartsHistory.newDayEstimate(history, site),
          })
        : [];
    const splitMakes =
      cursor.phase === "split"
        ? directory.makes.filter(
            (make) => cursor.afterMake === null || make > cursor.afterMake,
          ).length
        : 0;
    // Tokens are minted for the plan, not a fixed count, since the browser
    // bills every second it mints: each planned window (or make), both
    // canaries with a retry each, and room for one window to come back empty
    // (its canary, retried, and re-search). What a chunk leaves unused goes
    // to day and make searches and to splitting full windows.
    const budget = Math.min(
      UPULLRPARTS_CHUNK_SEARCHES,
      (cursor.phase === "crawl"
        ? windows.length + WINDOW_STEP_SEARCHES - 1
        : splitMakes) +
        2 * UPULLRPARTS_CANARY_SEARCHES,
    );
    const opened = yield* deps.openSearch(budget + TOKEN_RETRIES);
    let sent = 0;
    const search: UpullRPartsSearch<S> = (params) =>
      Effect.suspend(() => {
        sent += 1;
        return opened(params);
      });

    const searched = yield* Effect.gen(function* () {
      // A blocked IP returns empty lists that look like days with no stock.
      yield* checkUpullRPartsSearch(site, search, "before");
      // Opening the session counts toward the chunk's work limit.
      const workLeft = Option.getOrElse(
        yield* ProviderChunkClock.workLeft,
        () => Infinity,
      );
      const deadline =
        now() +
        Math.min(
          UPULLRPARTS_START_BUDGET_MS,
          workLeft - UPULLRPARTS_CHUNK_TAIL_MS,
        );
      const warnings: string[] = [];
      if (cursor.phase === "split") {
        const split = yield* crawlUpullRPartsDayByMake({
          site,
          day: cursor.day,
          makes: directory.makes,
          from: { afterMake: cursor.afterMake, missing: cursor.missing },
          search,
          // A make search and the closing canary, retried, must still fit.
          mayStart: () =>
            now() < deadline &&
            sent + 1 + UPULLRPARTS_CANARY_SEARCHES <= budget,
        });
        yield* checkUpullRPartsSearch(site, search, "after");
        const found: FoundVehicle[] = split.results.flatMap((result) =>
          result.records.map((record) => ({
            record,
            make: normalizeCanonicalMake(result.make),
          })),
        );
        const next: UpullRPartsCursor =
          split.progress.status === "complete"
            ? afterLocation(
                cursor,
                cursor.day > UPULLRPARTS_FIRST_DAY
                  ? UpullRPartsDay.add(cursor.day, -1)
                  : null,
                [],
              )
            : {
                source: "upullrparts",
                phase: "split",
                location: site,
                today: cursor.today,
                day: cursor.day,
                afterMake: split.progress.afterMake,
                missing: [...split.progress.missing],
                statePath: cursor.statePath,
                storesSeen: [],
              };
        return {
          status: "searched",
          found,
          rejectedRows: split.results.reduce(
            (total, result) => total + result.rejectedRows,
            0,
          ),
          next,
          warnings,
        } as const;
      }
      const crawl = yield* crawlUpullRPartsWindows({
        site,
        windows,
        search,
        // A window and the closing canary, retried, must still fit; an empty
        // window is rechecked only when its canary and re-search fit too.
        mayStart: () =>
          now() < deadline && sent + 1 + UPULLRPARTS_CANARY_SEARCHES <= budget,
        mayRecheck: () =>
          sent + WINDOW_STEP_SEARCHES - 1 + UPULLRPARTS_CANARY_SEARCHES <=
          budget,
      });
      const records = crawl.results.flatMap((result) => result.records);
      const known = new Map(
        [...history.known].map(([vin, vehicle]) => [vin, vehicle.make]),
      );
      const resolved = yield* resolveUpullRPartsMakes({
        site,
        vehicles: records.filter(isUsableUpullRPartsVehicle).map((record) => ({
          vin: record.VIN.trim().toUpperCase(),
          year: record.Year,
          model: record.Model,
          day: UpullRPartsDay.parse(record.DateSetData),
        })),
        known,
        index: UpullRPartsDirectory.index(directory),
        search,
        searchBudget: budget - sent - UPULLRPARTS_CANARY_SEARCHES,
        mayStart: () => now() < deadline + MAKE_SEARCH_GRACE_MS,
        decodeVins: deps.decodeVins,
      });
      warnings.push(...resolved.warnings);
      yield* checkUpullRPartsSearch(site, search, "after");
      const found: FoundVehicle[] = records.map((record) => ({
        record,
        make:
          resolved.makes.get(record.VIN?.trim().toUpperCase() ?? "") ?? "Other",
      }));
      const progress = crawl.progress;
      const next: UpullRPartsCursor =
        progress.status === "complete"
          ? afterLocation(cursor, null, [])
          : progress.status === "paused"
            ? afterLocation(cursor, progress.end, [])
            : {
                source: "upullrparts",
                phase: "split",
                location: site,
                today: cursor.today,
                day: progress.day,
                afterMake: null,
                missing: progress.sample.slice(0, UPULLRPARTS_SEARCH_LIMIT),
                statePath: cursor.statePath,
                storesSeen: [],
              };
      return {
        status: "searched",
        found,
        rejectedRows: crawl.results.reduce(
          (total, result) => total + result.rejectedRows,
          0,
        ),
        next,
        warnings,
      } as const;
    }).pipe(
      Effect.catchIf(
        (error) => error instanceof UpullRPartsSearchBlocked,
        (blocked) => waitForBlock(cursor, blocked, now()),
      ),
    );
    if (searched.status === "blocked") {
      yield* Effect.logWarning(searched.warning);
      const result: UpullRPartsStreamResult = {
        ...emptyResult(cursor),
        status: "paused",
        cursor: searched.cursor,
        warnings: [searched.warning],
        pagesProcessed: sent,
      };
      return result;
    }

    const accounting = {
      recordsProcessed: searched.found.length + searched.rejectedRows,
      recordsExcluded: 0,
      recordsRejected: searched.rejectedRows,
      duplicateVehicles: 0,
    };
    const storesSeen = new Set(cursor.storesSeen);
    const observedVins = new Set<string>();
    const unresolvedStores = new Map<number, number>();
    const seen = new Set<string>();
    const vehicles: UpullRPartsCanonicalVehicle[] = [];
    for (const { record, make } of searched.found) {
      const yard = findUpullRPartsYard(record.Store);
      if (yard && isUsableUpullRPartsVehicle(record))
        storesSeen.add(storeId(yard));
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
      const vehicle = transformUpullRPartsVehicle(record, yard, make);
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

    // A chunk whose canaries passed clears any block wait.
    const next: UpullRPartsCursor = {
      ...searched.next,
      storesSeen: [...storesSeen].sort((a, b) => a - b),
    };
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

    // A known vehicle keeps its stored photo; only new stock, and known
    // stock that had none, is looked up.
    const lookups = vehicles.filter((vehicle) => {
      const known = history.known.get(vehicle.vin);
      return !(
        known !== undefined &&
        known.imageUrl !== null &&
        known.stockNumber === vehicle.stockNumber
      );
    });
    const images = yield* loadUpullRPartsImages(
      lookups.map((vehicle) => vehicle.stockNumber),
    );
    for (const vehicle of vehicles) {
      const known = history.known.get(vehicle.vin);
      vehicle.imageUrl =
        known !== undefined &&
        known.imageUrl !== null &&
        known.stockNumber === vehicle.stockNumber
          ? known.imageUrl
          : vehicle.stockNumber === null
            ? null
            : (images.get(vehicle.stockNumber) ?? null);
    }
    for (
      let offset = 0;
      offset < vehicles.length;
      offset += UPULLRPARTS_BATCH_SIZE
    ) {
      yield* options.onBatch(
        vehicles.slice(offset, offset + UPULLRPARTS_BATCH_SIZE),
      );
    }
    const warnings = [
      ...searched.warnings,
      ...[...unresolvedStores].map(
        ([store, count]) =>
          `U Pull R Parts yard ${store}: skipped ${count} vehicles because yard coordinates are unresolved. Observed VINs preserve known inventory; verify public metadata before adding this yard.`,
      ),
    ];
    for (const warning of warnings) yield* Effect.logWarning(warning);
    const result: UpullRPartsStreamResult = {
      ...emptyResult(next),
      status: next.phase === "complete" ? "complete" : "paused",
      count: seen.size,
      pagesProcessed: sent,
      accounting,
      warnings,
      observedVins: [...observedVins],
    };
    return result;
  });
}

/**
 * Crawls U Pull R Parts by arrival date, one location at a time: a first
 * chunk loads the make directory, then each chunk searches one location's
 * date windows from its cursor back to the first day, sending at most
 * {@link UPULLRPARTS_CHUNK_SEARCHES} searches. Vehicles are emitted only
 * after a chunk's searches, both canaries and its photos all succeed, so a
 * failed chunk retries from its cursor without partial output.
 */
export function streamUpullRPartsInventoryWithSearch<E, R, S>(
  options: UpullRPartsStreamOptions<E, R>,
  deps: UpullRPartsChunkDeps<S>,
): Effect.Effect<UpullRPartsStreamResult, StreamError | S | E, R> {
  return Effect.gen(function* () {
    const now = deps.now ?? Date.now;
    const cursor = options.startCursor ?? UpullRPartsCursor.initial;
    if (cursor.phase === "complete") return emptyResult(cursor);
    if (cursor.phase === "directory")
      return yield* directoryChunk(options, deps.requestGate, now);
    const directory = yield* loadDirectory(cursor, options.loadState);
    return yield* Effect.scoped(
      searchChunk(cursor, directory, options, deps, now),
    );
  }).pipe(
    // Waiting for the browser session lease is not provider work.
    ProviderChunkClock.deadline({
      duration: UPULLRPARTS_CHUNK_WORK_LIMIT,
      onTimeout: () =>
        new UpullRPartsStreamError({
          message: `U Pull R Parts chunk exceeded its ${UPULLRPARTS_CHUNK_WORK_LIMIT} work limit. Retry from the same cursor; this chunk emitted no checkpoint and prior inventory is preserved.`,
        }),
    }),
  );
}

// Directory lookups (getMakes, getModels) stay serial and rate limited.
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

/** Defers the chunk, as the metered browser create would, once U Pull R
 * Parts' daily or monthly Kernel cap is spent, before it reads its
 * snapshot: a deferred chunk is retried every few minutes for hours. */
export function checkUpullRPartsKernelSpend(
  database: LibSQLDatabase,
): Effect.Effect<void, ProviderCapacityDeferred | UpullRPartsStreamError> {
  return Effect.tryPromise({
    try: () => KernelUsage.capReached(database, "upullrparts", new Date()),
    catch: (cause) =>
      new UpullRPartsStreamError({
        message: `U Pull R Parts could not read its Kernel spend (kernel_browser_usage) before opening a browser: ${String(cause)}. No browser was opened, no batches were emitted and prior inventory is preserved; retry the chunk once the database answers.`,
      }),
  }).pipe(
    Effect.flatMap((spent) =>
      spent === null
        ? Effect.void
        : Effect.fail(
            new ProviderCapacityDeferred({
              provider: "The Kernel spend guard",
              detail: spent.message,
            }),
          ),
    ),
  );
}

/** Makes of VINs from NHTSA's vPIC, which never fails the chunk: a decoder
 * that is down or slow decodes none. */
export const decodeUpullRPartsVinMakes: UpullRPartsVinMakes = (vehicles) =>
  Effect.tryPromise(async () => {
    const identities = vehicles.flatMap((vehicle) => {
      const identity = VinDecode.identity(vehicle.vin, vehicle.year);
      return identity === null ? [] : [identity];
    });
    if (identities.length === 0) return new Map<string, string>();
    const decoded = await vpicClient.decode(identities);
    return new Map(
      identities.flatMap((identity) => {
        const decode = decoded.decodes.get(identity.key);
        return decode === undefined ? [] : [[identity.vin, decode.make]];
      }),
    );
  }).pipe(
    Effect.timeout(VIN_DECODE_TIMEOUT),
    Effect.orElseSucceed(() => new Map<string, string>()),
  );

/**
 * Searches are sent natively from this process. Only Turnstile needs a
 * browser: a remote browser session under its provider's session lease mints
 * the chunk's tokens, opened by its first search and stopped once they are
 * minted or the chunk ends. `sessions` defaults to the source's headful Kernel
 * browsers on the stealth proxy (`KernelSessions.browserProfile`), metered
 * against its daily and monthly Kernel caps (`KernelUsage.metered`): once one
 * is spent, chunks defer without opening a browser until it resets.
 * `loadHistory` defaults to the published snapshot in `Database`.
 */
export function streamUpullRPartsInventory<E, R>(
  options: UpullRPartsStreamOptions<E, R> & {
    loadHistory?: () => Promise<UpullRPartsHistory>;
  },
  sessions?: BrowserSessions,
): Effect.Effect<
  UpullRPartsStreamResult,
  StreamError | SearchError | E,
  R | Config | Database
> {
  return Effect.gen(function* () {
    const database = yield* Database;
    const browsers =
      sessions ??
      KernelUsage.metered(
        DocumentTransport.kernel(
          (yield* Config).kernelApiKey,
          "upullrparts",
          "page",
        ),
        { database, source: "upullrparts" },
      );
    const loadHistory =
      options.loadHistory ?? (() => UpullRPartsHistory.load(database));
    const requestGate = yield* makeUpullRPartsRequestGate;
    return yield* streamUpullRPartsInventoryWithSearch(options, {
      requestGate,
      openSearch: (tokens) =>
        Effect.gen(function* () {
          const pace = yield* makeUpullRPartsSearchGate;
          const minted = yield* UpullRPartsTokens.make(
            UpullRPartsTurnstile.open(browsers, TOKEN_TABS),
            tokens,
          );
          return makeUpullRPartsTokenSearch(minted, pace);
        }),
      checkSpend: checkUpullRPartsKernelSpend(database),
      loadHistory: Effect.tryPromise({
        try: loadHistory,
        catch: (cause) =>
          new UpullRPartsStreamError({
            message: `U Pull R Parts could not read its published snapshot to plan the crawl: ${String(cause)}. No batches were emitted and prior inventory is preserved; retry the chunk once the database answers.`,
          }),
      }),
      decodeVins: decodeUpullRPartsVinMakes,
    });
  }).pipe(Effect.scoped);
}
