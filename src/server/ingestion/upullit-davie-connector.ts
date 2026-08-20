import { Effect } from "effect";
import type { ConnectorChunkResult } from "./connector-chunk";
import { fetchUpullitDaviePage } from "./upullit-davie-client";
import { transformUpullitDavieVehicle } from "./upullit-davie-transform";
import type { CanonicalVehicle } from "./types";

const PAGE_CONCURRENCY = 6;
const PAGE_CHUNK_SIZE = 24;
export const UPULLIT_DAVIE_MAX_CATALOG_PAGES = 2_000;

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
    if (
      firstPage.page !== startCursor.page ||
      !Number.isSafeInteger(firstPage.totalPages) ||
      firstPage.totalPages < 1 ||
      !Number.isSafeInteger(firstPage.totalCount) ||
      firstPage.totalCount < 0 ||
      !Number.isSafeInteger(firstPage.pageSize) ||
      firstPage.pageSize < 1
    ) {
      return yield* Effect.fail(
        new Error("U Pull It Davie returned invalid pagination metadata"),
      );
    }
    if (firstPage.totalPages > UPULLIT_DAVIE_MAX_CATALOG_PAGES) {
      return yield* Effect.fail(
        new Error(
          `U Pull It Davie exceeded the maximum catalog size of ${UPULLIT_DAVIE_MAX_CATALOG_PAGES} pages`,
        ),
      );
    }
    if (firstPage.totalCount === 0) {
      return yield* Effect.fail(
        new Error("U Pull It Davie returned an empty inventory catalog"),
      );
    }
    if (
      Math.ceil(firstPage.totalCount / firstPage.pageSize) !==
      firstPage.totalPages
    ) {
      return yield* Effect.fail(
        new Error(
          `U Pull It Davie returned inconsistent pagination metadata: ${firstPage.totalCount} records at ${firstPage.pageSize} per page cannot fill ${firstPage.totalPages} pages`,
        ),
      );
    }
    if (
      (startCursor.totalPages !== null &&
        firstPage.totalPages !== startCursor.totalPages) ||
      (startCursor.totalCount !== null &&
        firstPage.totalCount !== startCursor.totalCount) ||
      (startCursor.pageSize !== null &&
        firstPage.pageSize !== startCursor.pageSize)
    ) {
      return yield* Effect.fail(
        new Error(
          `U Pull It Davie pagination changed during ingestion: expected ${startCursor.totalPages} pages, ${startCursor.totalCount} records, and page size ${startCursor.pageSize}; received ${firstPage.totalPages} pages, ${firstPage.totalCount} records, and page size ${firstPage.pageSize}`,
        ),
      );
    }
    const totalPages = firstPage.totalPages;
    const totalCount = firstPage.totalCount;
    const pageSize = firstPage.pageSize;
    const expectedRecordsProcessed = Math.min(
      (startCursor.page - 1) * pageSize,
      totalCount,
    );
    if (
      startCursor.page > totalPages ||
      startCursor.recordsProcessed !== expectedRecordsProcessed ||
      startCursor.recordsRejected > startCursor.recordsProcessed
    ) {
      return yield* Effect.fail(
        new Error("U Pull It Davie received an inconsistent durable cursor"),
      );
    }
    const expectedFirstPageCount = Math.min(
      pageSize,
      totalCount - (firstPage.page - 1) * pageSize,
    );
    if (firstPage.vehicles.length !== expectedFirstPageCount) {
      return yield* Effect.fail(
        new Error(
          `U Pull It Davie page ${firstPage.page} returned ${firstPage.vehicles.length} records; expected ${expectedFirstPageCount}`,
        ),
      );
    }

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
        if (page.page !== expectedPage) {
          return yield* Effect.fail(
            new Error(
              `U Pull It Davie returned page ${page.page} when page ${expectedPage} was requested`,
            ),
          );
        }
        if (page.totalPages !== firstPage.totalPages) {
          return yield* Effect.fail(
            new Error(
              `U Pull It Davie pagination changed during ingestion: expected ${firstPage.totalPages}, received ${page.totalPages}`,
            ),
          );
        }
        if (page.totalCount !== totalCount) {
          return yield* Effect.fail(
            new Error(
              `U Pull It Davie inventory count changed during ingestion: expected ${totalCount}, received ${page.totalCount}`,
            ),
          );
        }
        if (page.pageSize !== pageSize) {
          return yield* Effect.fail(
            new Error(
              `U Pull It Davie page size changed during ingestion: expected ${pageSize}, received ${page.pageSize}`,
            ),
          );
        }
        const expectedPageCount = Math.min(
          pageSize,
          totalCount - (page.page - 1) * pageSize,
        );
        if (page.vehicles.length !== expectedPageCount) {
          return yield* Effect.fail(
            new Error(
              `U Pull It Davie page ${page.page} returned ${page.vehicles.length} records; expected ${expectedPageCount}`,
            ),
          );
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
