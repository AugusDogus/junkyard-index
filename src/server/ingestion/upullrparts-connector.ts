import { Data, Effect, Predicate, RateLimiter } from "effect";
import type { ConnectorChunkResult } from "./connector-chunk";
import { normalizeCanonicalMake } from "./normalization";
import type { ProviderRequestGate } from "./provider-http-client";
import {
  fetchUpullRPartsMakes,
  fetchUpullRPartsModels,
  fetchUpullRPartsYears,
  type UpullRPartsProviderError,
} from "./upullrparts-client";
import { UpullRPartsCursor } from "./upullrparts-cursor";
import { loadUpullRPartsImages } from "./upullrparts-images";
import {
  checkUpullRPartsSearch,
  crawlUpullRPartsMakes,
  UPULLRPARTS_LOCATIONS,
  type UpullRPartsCrawlError,
  type UpullRPartsSearch,
  type UpullRPartsSearchBlockedError,
} from "./upullrparts-make-crawl";
import { UpullRPartsSandboxSearch } from "./upullrparts-sandbox";
import {
  isUsableUpullRPartsVehicle,
  transformUpullRPartsVehicle,
  type UpullRPartsCanonicalVehicle,
} from "./upullrparts-transform";
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
 * A chunk stops starting makes after this long. Started makes finish (the
 * largest, Chevrolet in Minnesota, takes about three minutes), which keeps a
 * chunk inside the stream timeout and the 800-second function limit.
 */
export const UPULLRPARTS_MAKE_START_BUDGET_MS = 6 * 60_000;
const STREAM_TIMEOUT = "11 minutes";
const MAKE_CONCURRENCY = 1;

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

type StreamError =
  | UpullRPartsProviderError
  | UpullRPartsCrawlError
  | UpullRPartsSearchBlockedError
  | UpullRPartsStreamError;

/** Sandbox sessions to try when the search IP turns out to be blocked. */
const SEARCH_SESSION_ATTEMPTS = 3;

function storeId(yard: UpullRPartsYard): number {
  return Number(yard.code.replace("UPRRP-", ""));
}

function nextCursor(
  cursor: Extract<UpullRPartsCursor, { phase: "crawl" }>,
  progress:
    | { status: "complete" }
    | { status: "paused"; afterMake: string | null },
  storesSeen: number[],
): UpullRPartsCursor {
  if (progress.status === "paused")
    return { ...cursor, afterMake: progress.afterMake, storesSeen };
  const index = UPULLRPARTS_LOCATIONS.indexOf(cursor.location);
  const location = UPULLRPARTS_LOCATIONS[index + 1];
  return location === undefined
    ? { source: "upullrparts", phase: "complete", storesSeen }
    : {
        source: "upullrparts",
        phase: "crawl",
        location,
        afterMake: null,
        storesSeen,
      };
}

/**
 * Crawls U Pull R Parts make by make, one location at a time, for up to
 * {@link UPULLRPARTS_MAKE_START_BUDGET_MS} per chunk. Vehicles are emitted
 * only after a chunk's makes and photos all succeed, so a failed chunk
 * retries from its cursor without partial output.
 */
export function streamUpullRPartsInventoryWithSearch<E, R>(
  options: UpullRPartsStreamOptions<E, R>,
  requestGate: ProviderRequestGate,
  search: UpullRPartsSearch,
  now: () => number = Date.now,
): Effect.Effect<UpullRPartsStreamResult, StreamError | E, R> {
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

    const makes = yield* fetchUpullRPartsMakes(requestGate);
    // A blocked IP returns empty lists that look like makes with no stock.
    yield* checkUpullRPartsSearch(cursor.location, search, "before");
    const deadline = now() + UPULLRPARTS_MAKE_START_BUDGET_MS;
    const crawl = yield* crawlUpullRPartsMakes({
      site: cursor.location,
      makes,
      afterMake: cursor.afterMake,
      search,
      directory: {
        models: (make) => fetchUpullRPartsModels(make, requestGate),
        years: (make, model) => fetchUpullRPartsYears(make, model, requestGate),
      },
      makeConcurrency: MAKE_CONCURRENCY,
      shouldStartMake: () => now() < deadline,
    });
    yield* checkUpullRPartsSearch(cursor.location, search, "after");

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
    if (options.onYards && cursor.afterMake === null && cursor.location === "1")
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
    Effect.timeoutFail({
      duration: STREAM_TIMEOUT,
      onTimeout: () =>
        new UpullRPartsStreamError({
          message: `U Pull R Parts chunk exceeded ${STREAM_TIMEOUT}. Retry from the same cursor; this chunk emitted no checkpoint.`,
        }),
    }),
  );
}

// Directory lookups (getMakes, getModels, getYears) stay serial and rate limited.
export const makeUpullRPartsRequestGate = RateLimiter.make({
  limit: 1,
  interval: "1500 millis",
});

export function streamUpullRPartsInventory<E, R>(
  options: UpullRPartsStreamOptions<E, R>,
): Effect.Effect<UpullRPartsStreamResult, StreamError | E, R> {
  return Effect.gen(function* () {
    const requestGate = yield* makeUpullRPartsRequestGate;
    // Each attempt stops its sandbox session, and the next session gets a
    // new IP. A chunk emits nothing until its closing check passes.
    return yield* Effect.scoped(
      Effect.flatMap(UpullRPartsSandboxSearch, (search) =>
        streamUpullRPartsInventoryWithSearch(options, requestGate, search),
      ),
    ).pipe(
      Effect.retry({
        times: SEARCH_SESSION_ATTEMPTS - 1,
        while: (error) =>
          Predicate.isTagged(error, "UpullRPartsSearchBlockedError"),
      }),
    );
  }).pipe(Effect.scoped);
}
