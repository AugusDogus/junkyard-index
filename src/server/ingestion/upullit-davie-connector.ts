import { Effect } from "effect";
import type { ConnectorChunkResult } from "./connector-chunk";
import {
  UpullitDavieCatalog,
  UPULLIT_DAVIE_MAX_CATALOG_PAGES,
} from "./upullit-davie-catalog";
import { fetchUpullitDaviePage } from "./upullit-davie-client";
import { transformUpullitDavieVehicle } from "./upullit-davie-transform";
import type { CanonicalVehicle } from "./types";

const PAGE_CONCURRENCY = 6;
const PAGE_CHUNK_SIZE = 24;
export { UPULLIT_DAVIE_MAX_CATALOG_PAGES };

export interface UpullitDavieStreamCursor {
  page: number;
  totalPages: number | null;
  totalCount: number | null;
  pageSize: number | null;
  recordsProcessed: number;
  recordsRejected: number;
}

export type UpullitDavieStreamResult = ConnectorChunkResult<
  "upullitdavie",
  UpullitDavieStreamCursor
>;

export function streamUpullitDavieInventory<E, R>(options: {
  onBatch: (vehicles: CanonicalVehicle[]) => Effect.Effect<void, E, R>;
  startCursor?: UpullitDavieStreamCursor;
  maxPages?: number;
}): Effect.Effect<UpullitDavieStreamResult, Error | E, R> {
  return Effect.gen(function* () {
    const startCursor = options.startCursor ?? {
      page: 1,
      totalPages: null,
      totalCount: null,
      pageSize: null,
      recordsProcessed: 0,
      recordsRejected: 0,
    };
    const maxPages = Math.max(1, options.maxPages ?? Number.MAX_SAFE_INTEGER);
    const seen = new Map<string, CanonicalVehicle>();
    let pagesProcessed = 0;
    let recordsProcessed = startCursor.recordsProcessed;
    let recordsRejected = startCursor.recordsRejected;

    const ingestVehicles = (
      rawVehicles: ReadonlyArray<
        Parameters<typeof transformUpullitDavieVehicle>[0]
      >,
    ): CanonicalVehicle[] => {
      const batch: CanonicalVehicle[] = [];
      for (const rawVehicle of rawVehicles) {
        const vehicle = transformUpullitDavieVehicle(rawVehicle);
        if (!vehicle) {
          recordsRejected += 1;
          continue;
        }
        if (seen.has(vehicle.vin)) continue;
        seen.set(vehicle.vin, vehicle);
        batch.push(vehicle);
      }
      return batch;
    };

    const firstPage = yield* fetchUpullitDaviePage(startCursor.page);
    const catalogResult = UpullitDavieCatalog.fromFirstPage(firstPage);
    if (!catalogResult.success) {
      return yield* Effect.fail(catalogResult.error);
    }
    const catalog = catalogResult.value;
    const cursorValidation = UpullitDavieCatalog.validateCursor(
      startCursor,
      catalog,
    );
    if (!cursorValidation.success) {
      return yield* Effect.fail(cursorValidation.error);
    }
    const firstPageValidation = UpullitDavieCatalog.validatePage(
      firstPage,
      startCursor.page,
      catalog,
    );
    if (!firstPageValidation.success) {
      return yield* Effect.fail(firstPageValidation.error);
    }

    const { totalPages, totalCount, pageSize } = catalog;

    const firstBatch = ingestVehicles(firstPage.vehicles);
    if (firstBatch.length > 0) yield* options.onBatch(firstBatch);
    pagesProcessed = 1;
    recordsProcessed += firstPage.vehicles.length;
    let nextPage = firstPage.page + 1;

    while (nextPage <= totalPages && pagesProcessed < maxPages) {
      const requestCount = Math.min(
        PAGE_CHUNK_SIZE,
        totalPages - nextPage + 1,
        maxPages - pagesProcessed,
      );
      const requestedPages = Array.from(
        { length: requestCount },
        (_, index) => nextPage + index,
      );
      const pages = yield* Effect.all(
        requestedPages.map((expectedPage) =>
          fetchUpullitDaviePage(expectedPage).pipe(
            Effect.map((page) => ({ expectedPage, page })),
          ),
        ),
        { concurrency: PAGE_CONCURRENCY },
      );
      const batch: CanonicalVehicle[] = [];
      for (const { expectedPage, page } of pages) {
        const pageValidation = UpullitDavieCatalog.validatePage(
          page,
          expectedPage,
          catalog,
        );
        if (!pageValidation.success) {
          return yield* Effect.fail(pageValidation.error);
        }
        batch.push(...ingestVehicles(page.vehicles));
        recordsProcessed += page.vehicles.length;
        pagesProcessed += 1;
        nextPage = page.page + 1;
      }
      if (batch.length > 0) yield* options.onBatch(batch);
    }

    const complete = nextPage > totalPages;
    if (complete && recordsProcessed !== totalCount) {
      return yield* Effect.fail(
        new Error(
          `U Pull It Davie inventory count changed during ingestion: expected ${totalCount}, received ${recordsProcessed}`,
        ),
      );
    }
    if (complete && recordsRejected > 0) {
      return yield* Effect.fail(
        new Error(
          `U Pull It Davie discarded ${recordsRejected} invalid record${recordsRejected === 1 ? "" : "s"}; the catalog was not reconciled`,
        ),
      );
    }

    return {
      source: "upullitdavie" as const,
      status: complete ? "complete" : "paused",
      cursor: {
        page: nextPage,
        totalPages,
        totalCount,
        pageSize,
        recordsProcessed,
        recordsRejected,
      },
      count: seen.size,
      errors: [],
      pagesProcessed,
    };
  });
}
