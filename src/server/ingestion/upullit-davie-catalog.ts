import type { UpullitDaviePage } from "./upullit-davie-client";
import type { UpullitDavieCursorState } from "./durable-source";

export const UPULLIT_DAVIE_MAX_CATALOG_PAGES = 2_000;

type ValidationResult<Value> =
  | { success: true; value: Value }
  | { success: false; error: Error };

function success<Value>(value: Value): ValidationResult<Value> {
  return { success: true, value };
}

function failure(message: string): ValidationResult<never> {
  return { success: false, error: new Error(message) };
}

export type UpullitDavieCatalog = {
  totalPages: number;
  totalCount: number;
  pageSize: number;
};

export const UpullitDavieCatalog = {
  fromFirstPage(page: UpullitDaviePage): ValidationResult<UpullitDavieCatalog> {
    if (page.totalPages > UPULLIT_DAVIE_MAX_CATALOG_PAGES) {
      return failure(
        `U Pull It Davie exceeded the maximum catalog size of ${UPULLIT_DAVIE_MAX_CATALOG_PAGES} pages`,
      );
    }
    if (page.totalCount === 0) {
      return failure("U Pull It Davie returned an empty inventory catalog");
    }
    if (Math.ceil(page.totalCount / page.pageSize) !== page.totalPages) {
      return failure(
        `U Pull It Davie returned inconsistent pagination metadata: ${page.totalCount} records at ${page.pageSize} per page cannot fill ${page.totalPages} pages`,
      );
    }
    return success({
      totalPages: page.totalPages,
      totalCount: page.totalCount,
      pageSize: page.pageSize,
    });
  },

  validateCursor(
    cursor: UpullitDavieCursorState,
    catalog: UpullitDavieCatalog,
  ): ValidationResult<void> {
    if (
      (cursor.totalPages !== null &&
        catalog.totalPages !== cursor.totalPages) ||
      (cursor.totalCount !== null &&
        catalog.totalCount !== cursor.totalCount) ||
      (cursor.pageSize !== null && catalog.pageSize !== cursor.pageSize)
    ) {
      return failure(
        `U Pull It Davie pagination changed during ingestion: expected ${cursor.totalPages} pages, ${cursor.totalCount} records, and page size ${cursor.pageSize}; received ${catalog.totalPages} pages, ${catalog.totalCount} records, and page size ${catalog.pageSize}`,
      );
    }

    const expectedRecordsProcessed = Math.min(
      (cursor.page - 1) * catalog.pageSize,
      catalog.totalCount,
    );
    if (
      cursor.page > catalog.totalPages ||
      cursor.recordsProcessed !== expectedRecordsProcessed ||
      cursor.recordsRejected > cursor.recordsProcessed
    ) {
      return failure("U Pull It Davie received an inconsistent durable cursor");
    }
    return success(undefined);
  },

  validatePage(
    page: UpullitDaviePage,
    expectedPage: number,
    catalog: UpullitDavieCatalog,
  ): ValidationResult<void> {
    if (page.page !== expectedPage) {
      return failure(
        `U Pull It Davie returned page ${page.page} when page ${expectedPage} was requested`,
      );
    }
    if (page.totalPages !== catalog.totalPages) {
      return failure(
        `U Pull It Davie pagination changed during ingestion: expected ${catalog.totalPages}, received ${page.totalPages}`,
      );
    }
    if (page.totalCount !== catalog.totalCount) {
      return failure(
        `U Pull It Davie inventory count changed during ingestion: expected ${catalog.totalCount}, received ${page.totalCount}`,
      );
    }
    if (page.pageSize !== catalog.pageSize) {
      return failure(
        `U Pull It Davie page size changed during ingestion: expected ${catalog.pageSize}, received ${page.pageSize}`,
      );
    }

    const expectedPageCount = Math.min(
      catalog.pageSize,
      catalog.totalCount - (page.page - 1) * catalog.pageSize,
    );
    if (page.vehicles.length !== expectedPageCount) {
      return failure(
        `U Pull It Davie page ${page.page} returned ${page.vehicles.length} records; expected ${expectedPageCount}`,
      );
    }
    return success(undefined);
  },
} as const;
