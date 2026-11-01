import { describe, expect, test } from "bun:test";
import {
  nextUpullRPartsCatalogStep,
  UPULLRPARTS_CATALOG_PAGE_LIMIT,
} from "./upullrparts-browser-catalog";

function page(dates: readonly string[]) {
  return dates.map((DateSetData, index) => ({
    VIN: `VIN-${index}`,
    DateSetData,
  }));
}

function fullPage(newest: string, oldest: string) {
  return page([
    ...Array.from({ length: UPULLRPARTS_CATALOG_PAGE_LIMIT - 1 }, () => newest),
    oldest,
  ]);
}

describe("nextUpullRPartsCatalogStep", () => {
  test("completes on a page below the provider limit", () => {
    expect(
      nextUpullRPartsCatalogStep(page(["2026-10-30"]), "2026-11-01"),
    ).toEqual({
      status: "complete",
    });
  });

  test("continues through the oldest day, which a full page may cut off", () => {
    expect(
      nextUpullRPartsCatalogStep(
        fullPage("2026-10-30", "2026-10-22"),
        "2026-11-01",
      ),
    ).toEqual({ status: "continue", endDate: "2026-10-22" });
  });

  test("rejects a single day that fills a page, because dates cannot split it", () => {
    const step = nextUpullRPartsCatalogStep(
      fullPage("2026-10-22", "2026-10-22"),
      "2026-10-22",
    );
    expect(step.status).toBe("invalid");
  });

  test("rejects a full page with an undated vehicle instead of skipping older inventory", () => {
    const rows = [
      ...fullPage("2026-10-30", "2026-10-22").slice(1),
      { VIN: "VIN-undated", DateSetData: null },
    ];
    expect(nextUpullRPartsCatalogStep(rows, "2026-11-01").status).toBe(
      "invalid",
    );
  });
});
