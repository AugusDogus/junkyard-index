import { describe, expect, test } from "bun:test";
import { SearchAlertDigest, SearchAlertMatch } from "./search-alert-data";

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
});
