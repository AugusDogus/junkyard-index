import { describe, expect, test } from "bun:test";
import {
  combineSearchAlerts,
  SearchAlertDigest,
  SearchAlertMatch,
} from "./search-alert-data";

describe("search alert data", () => {
  test("rejects non-positive match counts", () => {
    expect(() => SearchAlertMatch.create(-1, [])).toThrow(
      "Invalid search alert match",
    );
    expect(() => SearchAlertMatch.create(0, [])).toThrow(
      "Invalid search alert match",
    );
  });

  test("rejects empty digests", () => {
    expect(() => SearchAlertDigest.create([], 0, 0)).toThrow(
      "Invalid search alert digest",
    );
  });

  test("rejects digest totals smaller than their previews", () => {
    const alert = {
      searchId: "search-1",
      searchName: "Search 1",
      query: "volvo",
      searchUrl: "https://example.com/search",
      match: SearchAlertMatch.create(2, []),
    };

    expect(() => SearchAlertDigest.create([alert], 1, 1)).toThrow(
      "Invalid search alert digest",
    );
  });

  test("combines repeated searches without dropping extras for Discord", () => {
    const first = {
      searchId: "0",
      searchName: "Search 0",
      query: "volvo",
      searchUrl: "https://example.com/search/0",
      match: SearchAlertMatch.create(1, []),
    };
    const alerts = [
      first,
      ...Array.from({ length: 11 }, (_, index) => ({
        searchId: String(index + 1),
        searchName: `Search ${index + 1}`,
        query: "volvo",
        searchUrl: `https://example.com/search/${index + 1}`,
        match: SearchAlertMatch.create(1, []),
      })),
    ];
    const combined = combineSearchAlerts([
      ...alerts,
      {
        ...first,
        match: SearchAlertMatch.create(2, []),
      },
    ]);

    expect(combined).toHaveLength(12);
    expect(combined[0]?.match.count).toBe(3);
  });
});
