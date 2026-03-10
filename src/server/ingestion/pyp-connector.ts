import { Effect, Scope } from "effect";
import type { Location } from "~/lib/types";
import {
  acquirePypSession,
  type PypFilterResponse,
  type PypSession,
} from "./pyp-browser-session";
import { transformPypVehicle } from "./pyp-transform";
import type { CanonicalVehicle } from "./types";
import { PypProviderError, BrowserSessionError } from "./errors";
import { Config } from "./runtime";

const PAGE_SIZE = 500;
const PAGE_COUNT_WARNING_THRESHOLD = 250;

export interface PypStreamResult {
  source: "pyp";
  count: number;
  errors: string[];
  pagesProcessed: number;
  nextPage: number;
  done: boolean;
}

function processPage(
  data: PypFilterResponse,
  pageNumber: number,
  locationMap: Map<string, Location>,
): {
  vehicleCount: number;
  canonical: CanonicalVehicle[];
  isLastPage: boolean;
  apiError: string | null;
} {
  if (!data.Success) {
    return {
      vehicleCount: 0,
      canonical: [],
      isLastPage: true,
      apiError: `PYP Filter API error on page ${pageNumber}: ${data.Errors.join(", ")}`,
    };
  }

  const pageVehicles = data.ResponseData?.Vehicles ?? [];
  if (pageVehicles.length === 0) {
    return { vehicleCount: 0, canonical: [], isLastPage: true, apiError: null };
  }

  const canonical: CanonicalVehicle[] = [];
  for (const v of pageVehicles) {
    const c = transformPypVehicle(v, locationMap);
    if (c) canonical.push(c);
  }

  return {
    vehicleCount: pageVehicles.length,
    canonical,
    isLastPage: pageVehicles.length < PAGE_SIZE,
    apiError: null,
  };
}

function buildLocationContext(locations: Location[]) {
  const locationMap = new Map<string, Location>();
  for (const loc of locations) {
    locationMap.set(loc.locationCode, loc);
  }
  const storeCodes = locations.map((l) => l.locationCode).join(",");
  return { locationMap, storeCodes };
}

function assertMinLocations(locations: Location[]) {
  if (locations.length < 20) {
    throw new Error(
      `PYP returned only ${locations.length} locations (expected 20+). ` +
        `This likely means PYP locations are currently unavailable. Aborting PYP ingestion for this run.`,
    );
  }
}

function notifyProgress<E, R>(
  onProgress:
    | ((progress: {
        nextPage: number;
        pagesProcessed: number;
        vehiclesProcessed: number;
        done: boolean;
        errors: string[];
      }) => Effect.Effect<void, E, R>)
    | undefined,
  progress: {
    nextPage: number;
    pagesProcessed: number;
    vehiclesProcessed: number;
    done: boolean;
    errors: string[];
  },
): Effect.Effect<void, E, R> {
  if (!onProgress) {
    return Effect.succeed(undefined);
  }

  return onProgress(progress);
}

/**
 * Effect-based PYP inventory stream.
 * Uses a scoped browser session that is automatically cleaned up on failure or completion.
 */
export function streamPypInventory<E, R>(options: {
  onBatch: (vehicles: CanonicalVehicle[]) => Effect.Effect<void, E, R>;
  startPage?: number;
  onProgress?: (progress: {
    nextPage: number;
    pagesProcessed: number;
    vehiclesProcessed: number;
    done: boolean;
    errors: string[];
  }) => Effect.Effect<void, E, R>;
}): Effect.Effect<
  PypStreamResult,
  PypProviderError | BrowserSessionError | E,
  Config | Scope.Scope | R
> {
  return Effect.gen(function* () {
    const config = yield* Config;
    const apiKey = config.hyperbrowserApiKey;
    if (!apiKey) {
      return yield* Effect.fail(
        new BrowserSessionError({
          phase: "open",
          cause: new Error("HYPERBROWSER_API_KEY must be set"),
        }),
      );
    }

    const session: PypSession = yield* acquirePypSession(apiKey);
    yield* Effect.try({
      try: () => assertMinLocations(session.locations),
      catch: (cause) =>
        new BrowserSessionError({
          phase: "open",
          cause,
        }),
    });
    let { locationMap, storeCodes } = buildLocationContext(session.locations);

    let nextPage = Math.max(1, options.startPage ?? 1);
    let totalCount = 0;
    let pagesProcessed = 0;
    let done = false;
    let sessionCount = 1;
    const errors: string[] = [];

    yield* Effect.logInfo(
      `[PYP] Streaming inventory from ${session.locations.length} locations via browser-proxied JSON API`,
    );

    while (!done) {
      if (session.shouldRotate) {
        yield* Effect.logInfo(
          `[PYP] Rotating session (session #${sessionCount} done, page ${nextPage} next)`,
        );
        yield* session.reopen();
        ({ locationMap, storeCodes } = buildLocationContext(session.locations));
        sessionCount++;
        yield* Effect.logInfo(
          `[PYP] New session #${sessionCount} ready, resuming from page ${nextPage}`,
        );
      }

      const fetchResult = yield* session
        .fetchFilterPage(storeCodes, nextPage, PAGE_SIZE)
        .pipe(
          Effect.map(
            (data) =>
              ({ ok: true as const, pageNumber: nextPage, data }) as const,
          ),
          Effect.catchAll((err) =>
            Effect.succeed({
              ok: false as const,
              pageNumber: nextPage,
              error: err,
            } as const),
          ),
        );

      if (!fetchResult.ok) {
        const msg = fetchResult.error.message;
        yield* Effect.logError(msg);
        errors.push(msg);
        done = true;
        yield* notifyProgress(options.onProgress, {
          nextPage,
          pagesProcessed,
          vehiclesProcessed: totalCount,
          done: true,
          errors,
        });
        break;
      }

      const result = processPage(
        fetchResult.data,
        fetchResult.pageNumber,
        locationMap,
      );

      yield* Effect.logInfo(
        `[PYP] Page ${fetchResult.pageNumber}: ${result.vehicleCount} vehicles fetched, ${result.canonical.length} transformed (${totalCount + result.canonical.length} total)`,
      );

      if (result.apiError) {
        errors.push(result.apiError);
        done = true;
        yield* notifyProgress(options.onProgress, {
          nextPage,
          pagesProcessed,
          vehiclesProcessed: totalCount,
          done: true,
          errors,
        });
        break;
      }

      if (result.canonical.length > 0) {
        yield* options.onBatch(result.canonical);
      }

      totalCount += result.canonical.length;
      pagesProcessed += 1;

      if (fetchResult.pageNumber === PAGE_COUNT_WARNING_THRESHOLD) {
        yield* Effect.logWarning(
          `[PYP] Reached ${PAGE_COUNT_WARNING_THRESHOLD} pages (${totalCount} vehicles). ` +
            `This is unusually high — verify PYP API is paginating correctly.`,
        );
      }

      if (result.isLastPage) {
        nextPage += 1;
        done = true;
        yield* notifyProgress(options.onProgress, {
          nextPage,
          pagesProcessed,
          vehiclesProcessed: totalCount,
          done: true,
          errors,
        });
        break;
      }

      nextPage += 1;

      if (options.onProgress) {
        yield* notifyProgress(options.onProgress, {
          nextPage,
          pagesProcessed,
          vehiclesProcessed: totalCount,
          done,
          errors,
        });
      }
    }

    yield* Effect.logInfo(
      `[PYP] Stream complete: ${totalCount} vehicles across ${pagesProcessed} pages (${sessionCount} session${sessionCount > 1 ? "s" : ""}), ${errors.length} errors`,
    );

    return {
      source: "pyp" as const,
      count: totalCount,
      errors,
      pagesProcessed,
      nextPage,
      done: true,
    };
  });
}

