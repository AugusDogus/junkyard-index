import { describe, expect, test } from "bun:test";
import type { UpullitDaviePage } from "./upullit-davie-client";
import { UpullitDavieCatalog } from "./upullit-davie-catalog";

function page(overrides: Partial<UpullitDaviePage> = {}): UpullitDaviePage {
  return {
    vehicles: [],
    totalCount: 3,
    page: 1,
    pageSize: 2,
    totalPages: 2,
    ...overrides,
  };
}

describe("U Pull It Davie catalog validation", () => {
  test("derives stable catalog metadata from the first page", () => {
    expect(UpullitDavieCatalog.fromFirstPage(page())).toEqual({
      success: true,
      value: { totalCount: 3, pageSize: 2, totalPages: 2 },
    });
  });

  test("rejects a resumed cursor that no longer matches the catalog", () => {
    const result = UpullitDavieCatalog.validateCursor(
      {
        page: 2,
        totalPages: 2,
        totalCount: 4,
        pageSize: 2,
        recordsProcessed: 2,
        recordsRejected: 0,
      },
      { totalCount: 3, pageSize: 2, totalPages: 2 },
    );

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.message).toContain("changed");
  });

  test("validates page identity, metadata, and cardinality together", () => {
    const result = UpullitDavieCatalog.validatePage(
      page({ page: 2, vehicles: [] }),
      2,
      { totalCount: 3, pageSize: 2, totalPages: 2 },
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.message).toContain("returned 0 records; expected 1");
    }
  });
});
