import { describe, expect, test } from "bun:test";
import { ALGOLIA_SEARCH_INDEX_NAMES } from "~/lib/constants";
import { buildVinFilterValidationRequests } from "./search-index-validation";

describe("search index migration validation", () => {
  test("validates VIN filtering on the primary and every selectable replica", () => {
    const requests = buildVinFilterValidationRequests("1FADP3F29FL123456");
    expect(requests.map((request) => request.indexName)).toEqual([
      ...ALGOLIA_SEARCH_INDEX_NAMES,
    ]);
    expect(requests.every((request) => request.filters.length > 0)).toBe(true);
    expect(
      requests.every((request) => request.filters.includes("searchTokens:")),
    ).toBe(true);
  });
});
