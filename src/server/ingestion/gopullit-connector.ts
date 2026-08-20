import { Effect, RateLimiter } from "effect";
import type { ConnectorChunkResult } from "./connector-chunk";
import { GopullitCursorState } from "./durable-cursor";
import { fetchGopullitPage, GopullitSession } from "./gopullit-client";
import {
  hasGopullitVehicleMetadata,
  resolveGopullitLocation,
  transformGopullitVehicle,
} from "./gopullit-transform";
import type { ProviderRequestGate } from "./provider-http-client";
import type { CanonicalVehicle } from "./types";

const PAGE_CONCURRENCY = 6;
const PAGE_CHUNK_SIZE = 24;
const PROVIDER_PAGE_SIZE = 10;
export const GOPULLIT_MAX_CATALOG_PAGES = 5_000;
// Production began returning 429s after 64 requests in one minute. Keep
// enough headroom for provider-side accounting differences and other traffic.
const REQUEST_INTERVAL = "1500 millis";
// New uploads briefly lack vehicle metadata. Fail closed if that normal queue
// grows large enough to indicate a provider response regression.
const MAX_INCOMPLETE_RECORD_RATIO = 0.1;

export type GopullitStreamCursor = GopullitCursorState;

export type GopullitStreamResult = ConnectorChunkResult<
  "gopullit",
  GopullitStreamCursor
>;

function pageChunk(startPage: number, length: number): number[] {
  return Array.from({ length }, (_, index) => startPage + index);
}

interface GopullitStreamOptions<E, R> {
  onBatch: (vehicles: CanonicalVehicle[]) => Effect.Effect<void, E, R>;
  startCursor?: GopullitStreamCursor;
  maxPages?: number;
}

export function streamGopullitInventoryWithRequestGate<E, R>(
  options: GopullitStreamOptions<E, R>,
  requestGate: ProviderRequestGate,
): Effect.Effect<GopullitStreamResult, Error | E, R> {
  return Effect.gen(function* () {
    const seen = new Map<string, CanonicalVehicle>();
    let pagesProcessed = 0;
    const startCursor = options.startCursor ?? GopullitCursorState.initial;
    let providerRecordsProcessed = startCursor.recordsProcessed;
    let recordsSkipped = startCursor.recordsSkipped;
    const startPage = Math.max(1, startCursor.page);
    const maxPages = Math.max(1, options.maxPages ?? Number.MAX_SAFE_INTEGER);
    let nextPage = startPage;
    let complete = false;
    const session = GopullitSession.make();

    while (!complete && pagesProcessed < maxPages) {
      const remainingCatalogPages = GOPULLIT_MAX_CATALOG_PAGES - nextPage + 1;
      if (remainingCatalogPages <= 0) {
        return yield* Effect.fail(
          new Error(
            `GO Pull-It exceeded the maximum catalog size of ${GOPULLIT_MAX_CATALOG_PAGES} pages`,
          ),
        );
      }
      const requestCount = Math.min(
        nextPage === startPage ? 1 : PAGE_CHUNK_SIZE,
        maxPages - pagesProcessed,
        remainingCatalogPages,
      );
      const responses = yield* Effect.all(
        pageChunk(nextPage, requestCount).map((page) =>
          fetchGopullitPage(page, requestGate, session).pipe(
            Effect.map((records) => ({ page, records })),
          ),
        ),
        { concurrency: nextPage === startPage ? 1 : PAGE_CONCURRENCY },
      );
      const batch: CanonicalVehicle[] = [];
      let terminalPage: number | null = null;

      for (const response of responses) {
        if (terminalPage !== null) {
          if (response.records.length > 0) {
            return yield* Effect.fail(
              new Error(
                `GO Pull-It returned records on page ${response.page} after terminal page ${terminalPage}`,
              ),
            );
          }
          continue;
        }

        if (response.records.length > PROVIDER_PAGE_SIZE) {
          return yield* Effect.fail(
            new Error(
              `GO Pull-It page ${response.page} exceeded the expected ${PROVIDER_PAGE_SIZE}-record page size`,
            ),
          );
        }
        if (response.records.length === 0) {
          terminalPage = response.page;
          complete = true;
          continue;
        }
        providerRecordsProcessed += response.records.length;

        for (const record of response.records) {
          if (!hasGopullitVehicleMetadata(record)) {
            recordsSkipped += 1;
            continue;
          }
          const location = resolveGopullitLocation(record);
          if (!location) {
            return yield* Effect.fail(
              new Error(
                `GO Pull-It record ${record.id} returned unknown yard ${record.yardCity.trim()}, ${record.yardState.trim()}`,
              ),
            );
          }
          const vehicle = transformGopullitVehicle(record, location);
          if (!vehicle) {
            return yield* Effect.fail(
              new Error(
                `GO Pull-It record ${record.id} contained invalid vehicle metadata`,
              ),
            );
          }
          if (seen.has(vehicle.vin)) continue;
          seen.set(vehicle.vin, vehicle);
          batch.push(vehicle);
        }

        pagesProcessed += 1;
        nextPage = response.page + 1;
        if (response.records.length < PROVIDER_PAGE_SIZE) {
          terminalPage = response.page;
          complete = true;
        }
      }

      if (batch.length > 0) yield* options.onBatch(batch);
      if (terminalPage !== null) break;
    }

    if (!complete && nextPage > GOPULLIT_MAX_CATALOG_PAGES) {
      return yield* Effect.fail(
        new Error(
          `GO Pull-It exceeded the maximum catalog size of ${GOPULLIT_MAX_CATALOG_PAGES} pages`,
        ),
      );
    }

    if (complete && providerRecordsProcessed === 0) {
      return yield* Effect.fail(
        new Error("GO Pull-It returned an empty inventory catalog"),
      );
    }
    if (
      complete &&
      recordsSkipped / providerRecordsProcessed > MAX_INCOMPLETE_RECORD_RATIO
    ) {
      return yield* Effect.fail(
        new Error(
          `GO Pull-It returned ${recordsSkipped} incomplete records out of ${providerRecordsProcessed}; the catalog was not reconciled`,
        ),
      );
    }

    yield* Effect.logInfo(
      `[GO Pull-It] Ingested ${seen.size} vehicles and skipped ${recordsSkipped} records awaiting provider metadata`,
    );
    return {
      source: "gopullit" as const,
      status: complete ? "complete" : "paused",
      cursor: {
        page: nextPage,
        recordsProcessed: providerRecordsProcessed,
        recordsSkipped,
      },
      count: seen.size,
      errors: [],
      pagesProcessed,
    };
  });
}

export function streamGopullitInventory<E, R>(
  options: GopullitStreamOptions<E, R>,
): Effect.Effect<GopullitStreamResult, Error | E, R> {
  return Effect.scoped(
    RateLimiter.make({
      limit: 1,
      interval: REQUEST_INTERVAL,
    }).pipe(
      Effect.flatMap((requestGate) =>
        streamGopullitInventoryWithRequestGate(options, requestGate),
      ),
    ),
  );
}
