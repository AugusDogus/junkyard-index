import { pypYard, type OnYards } from "./yard-metadata";
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
import { Config } from "./context";
import type { ConnectorChunkResult } from "./connector-chunk";
import type {
  DurableCursorFor,
  PypActiveCursor,
  PypStoreCursor,
} from "./durable-cursor";

const PAGE_SIZE = 500;
const PAGE_COUNT_WARNING_THRESHOLD = 250;

export type PypStreamResult = ConnectorChunkResult<
  "pyp",
  DurableCursorFor<"pyp">
>;

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

function orderedStoreCodes(locations: Location[]): string[] {
  const codes = locations.map((location) => location.locationCode).sort();
  if (new Set(codes).size !== codes.length) {
    throw new Error("PYP location list contains duplicate store codes");
  }
  return codes;
}

function assertSameStores(expected: string[] | null, actual: string[]) {
  if (
    expected !== null &&
    (expected.length !== actual.length ||
      expected.some((code, index) => code !== actual[index]))
  ) {
    throw new Error(
      "PYP store list changed during the inventory run. Start a new run so every store is crawled exactly once.",
    );
  }
}

// Numeric checkpoints belong to in-flight global crawls. Finish those runs
// with their original traversal so one snapshot does not mix page schemes.
function streamLegacyPypInventory<E, R>(options: {
  onBatch: (vehicles: CanonicalVehicle[]) => Effect.Effect<void, E, R>;
  onYards?: OnYards;
  startPage?: number;
  maxPages?: number;
}): Effect.Effect<
  ConnectorChunkResult<"pyp", number>,
  PypProviderError | BrowserSessionError | E,
  Config | Scope.Scope | R
> {
  return Effect.gen(function* () {
    const config = yield* Config;
    const session: PypSession = yield* acquirePypSession(
      config.hyperbrowserApiKey,
    );
    yield* Effect.try({
      try: () => assertMinLocations(session.locations),
      catch: (cause) =>
        new BrowserSessionError({
          phase: "open",
          cause,
        }),
    });
    let { locationMap, storeCodes } = buildLocationContext(session.locations);
    if (options.onYards) yield* options.onYards(session.locations.map(pypYard));

    let nextPage = Math.max(0, options.startPage ?? 0);
    let totalCount = 0;
    let pagesProcessed = 0;
    let done = false;
    let sessionCount = 1;
    const errors: string[] = [];

    yield* Effect.logInfo(
      `[PYP] Streaming inventory from ${session.locations.length} locations via browser-proxied JSON API`,
    );

    const maxPages = Math.max(1, options.maxPages ?? Number.MAX_SAFE_INTEGER);

    while (!done && pagesProcessed < maxPages) {
      if (session.shouldRotate) {
        yield* Effect.logInfo(
          `[PYP] Rotating session (session #${sessionCount} done, page ${nextPage} next)`,
        );
        yield* session.reopen();
        ({ locationMap, storeCodes } = buildLocationContext(session.locations));
        if (options.onYards)
          yield* options.onYards(session.locations.map(pypYard));
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
        break;
      }

      nextPage += 1;
    }

    yield* Effect.logInfo(
      `[PYP] Stream ${done ? "complete" : "paused"}: ${totalCount} vehicles across ${pagesProcessed} pages (${sessionCount} session${sessionCount > 1 ? "s" : ""}), ${errors.length} errors`,
    );

    return {
      source: "pyp" as const,
      status: errors.length > 0 ? "failed" : done ? "complete" : "paused",
      cursor: nextPage,
      count: totalCount,
      errors,
      pagesProcessed,
    };
  });
}

// Freeze the store list in the cursor so a changing directory cannot silently
// skip a yard while a run moves between durable workflow chunks.
function streamStorePypInventory<E, R>(options: {
  onBatch: (vehicles: CanonicalVehicle[]) => Effect.Effect<void, E, R>;
  onYards?: OnYards;
  cursor: PypStoreCursor;
  maxPages?: number;
}): Effect.Effect<
  ConnectorChunkResult<"pyp", PypStoreCursor>,
  PypProviderError | BrowserSessionError | E,
  Config | Scope.Scope | R
> {
  return Effect.gen(function* () {
    const config = yield* Config;
    const session = yield* acquirePypSession(config.hyperbrowserApiKey);
    const storeCodes = yield* Effect.try({
      try: () => {
        assertMinLocations(session.locations);
        const codes = orderedStoreCodes(session.locations);
        assertSameStores(options.cursor.storeCodes, codes);
        return codes;
      },
      catch: (cause) => new BrowserSessionError({ phase: "open", cause }),
    });
    let locationMap = new Map(
      session.locations.map((location) => [location.locationCode, location]),
    );
    if (options.onYards) yield* options.onYards(session.locations.map(pypYard));

    let cursor: PypActiveCursor = {
      source: "pyp",
      storeCodes,
      storeIndex: options.cursor.storeIndex,
      page: options.cursor.page,
    };
    let count = 0;
    let pagesProcessed = 0;
    let sessionCount = 1;
    const errors: string[] = [];
    const maxPages = Math.max(1, options.maxPages ?? Number.MAX_SAFE_INTEGER);

    yield* Effect.logInfo(
      `[PYP] Streaming inventory from ${storeCodes.length} stores via zero-based per-store JSON pages`,
    );

    while (cursor.storeIndex < storeCodes.length && pagesProcessed < maxPages) {
      const storeCode = storeCodes[cursor.storeIndex];
      if (storeCode === undefined) {
        return yield* Effect.fail(
          new BrowserSessionError({
            phase: "fetch",
            cause: new Error(`PYP store index ${cursor.storeIndex} is missing`),
          }),
        );
      }

      if (session.shouldRotate) {
        yield* Effect.logInfo(
          `[PYP] Rotating session before store ${storeCode} page ${cursor.page}`,
        );
        yield* session.reopen();
        yield* Effect.try({
          try: () =>
            assertSameStores(storeCodes, orderedStoreCodes(session.locations)),
          catch: (cause) => new BrowserSessionError({ phase: "rotate", cause }),
        });
        locationMap = new Map(
          session.locations.map((location) => [
            location.locationCode,
            location,
          ]),
        );
        if (options.onYards)
          yield* options.onYards(session.locations.map(pypYard));
        sessionCount++;
      }

      const pageNumber: number = cursor.page;
      const fetchResult = yield* session
        .fetchFilterPage(storeCode, pageNumber, PAGE_SIZE)
        .pipe(
          Effect.map((data) => ({ ok: true as const, data })),
          Effect.catchAll((error) =>
            Effect.succeed({ ok: false as const, error }),
          ),
        );
      if (!fetchResult.ok) {
        const message = `PYP store ${storeCode}: ${fetchResult.error.message}`;
        yield* Effect.logError(message);
        errors.push(message);
        break;
      }

      const data = fetchResult.data;
      if (!data.Success) {
        errors.push(
          `PYP store ${storeCode} page ${pageNumber}: ${data.Errors.join(", ")}`,
        );
        break;
      }
      const request = data.ResponseData.Request;
      const mismatchedVehicle = data.ResponseData.Vehicles.find(
        (vehicle) => vehicle.YardCode !== storeCode,
      );
      if (
        request.PageNumber !== pageNumber + 1 ||
        request.PageSize !== PAGE_SIZE ||
        request.YardCode.length !== 1 ||
        request.YardCode[0] !== storeCode ||
        mismatchedVehicle !== undefined
      ) {
        errors.push(
          `PYP store ${storeCode} page ${pageNumber}: response does not match the request. Expected yard ${storeCode}, echoed page ${pageNumber + 1}, size ${PAGE_SIZE}; got yards ${request.YardCode.join(",")}, page ${request.PageNumber}, size ${request.PageSize}, first unexpected vehicle yard ${mismatchedVehicle?.YardCode ?? "none"}. No checkpoint advanced; inspect the PYP API contract.`,
        );
        break;
      }

      const result = processPage(data, pageNumber, locationMap);
      if (result.apiError) {
        errors.push(`PYP store ${storeCode}: ${result.apiError}`);
        break;
      }
      if (result.canonical.length > 0) {
        yield* options.onBatch(result.canonical);
      }
      count += result.canonical.length;
      pagesProcessed++;
      yield* Effect.logInfo(
        `[PYP] Store ${storeCode} page ${pageNumber}: ${result.vehicleCount} vehicles fetched, ${result.canonical.length} transformed (${count} this chunk)`,
      );

      cursor = result.isLastPage
        ? { ...cursor, storeIndex: cursor.storeIndex + 1, page: 0 }
        : { ...cursor, page: pageNumber + 1 };
    }

    const status =
      errors.length > 0
        ? "failed"
        : cursor.storeIndex === storeCodes.length
          ? "complete"
          : "paused";
    yield* Effect.logInfo(
      `[PYP] Per-store stream ${status}: ${count} vehicles across ${pagesProcessed} pages (${sessionCount} sessions), ${errors.length} errors`,
    );
    return {
      source: "pyp" as const,
      status,
      cursor,
      count,
      errors,
      pagesProcessed,
    };
  });
}

export function streamPypInventory<E, R>(options: {
  onBatch: (vehicles: CanonicalVehicle[]) => Effect.Effect<void, E, R>;
  onYards?: OnYards;
  cursor: DurableCursorFor<"pyp">;
  maxPages?: number;
}): Effect.Effect<
  PypStreamResult,
  PypProviderError | BrowserSessionError | E,
  Config | Scope.Scope | R
> {
  if ("storeCodes" in options.cursor) {
    return streamStorePypInventory({ ...options, cursor: options.cursor });
  }
  return streamLegacyPypInventory({
    ...options,
    startPage: options.cursor.page,
  }).pipe(
    Effect.map((result) => ({
      ...result,
      cursor: { source: "pyp" as const, page: result.cursor },
    })),
  );
}
