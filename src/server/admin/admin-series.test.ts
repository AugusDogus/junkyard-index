import { describe, expect, test } from "bun:test";
import { AdminSeries } from "./admin-series";

describe("AdminSeries", () => {
  test("names UTC days, oldest first, ending today", () => {
    expect(AdminSeries.lastDays(new Date("2026-11-03T01:00:00Z"), 4)).toEqual([
      "2026-10-31",
      "2026-11-01",
      "2026-11-02",
      "2026-11-03",
    ]);
  });

  test("fills days without rows with zero and drops rows outside the days", () => {
    expect(
      AdminSeries.fillDays(
        [
          { day: "2026-11-02", value: 3 },
          { day: "2026-10-01", value: 9 },
        ],
        ["2026-11-01", "2026-11-02"],
      ),
    ).toEqual([
      { day: "2026-11-01", value: 0 },
      { day: "2026-11-02", value: 3 },
    ]);
  });

  test("adds rows for the same day", () => {
    expect(
      AdminSeries.fillDays(
        [
          { day: "2026-11-01", value: 1.5 },
          { day: "2026-11-01", value: 2 },
        ],
        ["2026-11-01"],
      ),
    ).toEqual([{ day: "2026-11-01", value: 3.5 }]);
  });

  test("sums days into weeks starting on Monday", () => {
    // 2026-11-01 is a Sunday; 2026-11-02 and 2026-11-08 bound the next week.
    expect(
      AdminSeries.weeks([
        { day: "2026-11-01", value: 1 },
        { day: "2026-11-02", value: 2 },
        { day: "2026-11-08", value: 3 },
        { day: "2026-11-09", value: 4 },
      ]),
    ).toEqual([
      { day: "2026-10-26", value: 1 },
      { day: "2026-11-02", value: 5 },
      { day: "2026-11-09", value: 4 },
    ]);
  });
});
