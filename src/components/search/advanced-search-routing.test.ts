import { describe, expect, test } from "bun:test";
import {
  buildAdvancedSearchUrl,
  readAdvancedSearchDraft,
  type AdvancedSearchDraft,
} from "./advanced-search-routing";

const YEAR_LIMITS = { min: 1900, max: 2027 };

const DRAFT: AdvancedSearchDraft = {
  query: '"Grand Cherokee" (Jeep OR Toyota) !damaged',
  makes: ["Jeep", "Toyota"],
  colors: ["Green"],
  states: ["Texas"],
  salvageYards: ["Houston"],
  sources: ["pyp"],
  yearRange: [1999, 2020],
  sortBy: "year-desc",
};

describe("advanced search routing", () => {
  test("round trips the query and every advanced filter", () => {
    const url = buildAdvancedSearchUrl(DRAFT, YEAR_LIMITS, true);
    const params = new URL(url, "https://junkyardindex.com").searchParams;

    expect(readAdvancedSearchDraft(params, YEAR_LIMITS)).toEqual(DRAFT);
  });

  test("removes plan-gated filters while preserving query and sort", () => {
    const url = buildAdvancedSearchUrl(DRAFT, YEAR_LIMITS, false);
    const params = new URL(url, "https://junkyardindex.com").searchParams;

    expect(params.get("q")).toBe(DRAFT.query);
    expect(params.get("sort")).toBe("year-desc");
    expect(params.has("makes")).toBe(false);
    expect(params.has("minYear")).toBe(false);
  });

  test("normalizes invalid years and sort values from the URL", () => {
    const params = new URLSearchParams({
      minYear: "2030",
      maxYear: "1980",
      sort: "unknown",
    });

    expect(readAdvancedSearchDraft(params, YEAR_LIMITS)).toMatchObject({
      yearRange: [1980, 2027],
      sortBy: "newest",
    });
  });
});
