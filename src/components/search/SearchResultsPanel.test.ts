import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { SearchResult } from "~/lib/types";
import {
  SearchResultsPanel,
  resolveSearchResultsPanelModel,
} from "./SearchResultsPanel";

const emptyResult: SearchResult = {
  vehicles: [],
  totalCount: 0,
  page: 1,
  hasMore: false,
  searchTime: 0,
  locationsCovered: 0,
  locationsWithErrors: [],
};

function resolve(input: {
  isSearching?: boolean;
  hasError?: boolean;
  searchResult?: SearchResult | null;
}) {
  const showMore = () => undefined;
  return resolveSearchResultsPanelModel({
    lifecycle: {
      hasActiveSearch: true,
      isSearching: input.isSearching ?? false,
      hasError: input.hasError ?? false,
      searchResult:
        "searchResult" in input ? (input.searchResult ?? null) : emptyResult,
    },
    header: { actions: null, processingTimeMS: 10, visibleCount: null },
    loading: { showMore },
    empty: {
      activeFilterCount: 0,
      clearAllFilters: () => undefined,
      isLoggedIn: false,
      query: "honda",
      filters: {},
      planAccess: { kind: "resolved", tier: "free" },
      saveSearchSignUpHref: "/auth/sign-up",
      analyticsQuery: "honda",
    },
    results: {
      isLoading: false,
      showMore,
      isLastPage: true,
      isFetchingNextPage: false,
    },
  });
}

describe("search results state", () => {
  test("zero results suggest changing the query even with the default yard filter", () => {
    const model = resolve({});
    if (model.kind !== "empty")
      throw new Error("Expected an empty result model");
    const markup = renderToStaticMarkup(
      createElement(SearchResultsPanel, {
        model: {
          ...model,
          query: "1990 toyota tacoma",
          activeFilterCount: 1,
          filters: { yardTypes: ["self_service"] },
        },
      }),
    );
    expect(markup).toContain("Try nearby years or remove a search term");
    expect(markup).toContain("include more yard types");
    expect(markup).not.toContain("Clear the filters to broaden the search");
  });

  test("the results heading uses the singular for one vehicle", () => {
    const markup = renderToStaticMarkup(
      createElement(SearchResultsPanel, {
        model: resolve({ searchResult: { ...emptyResult, totalCount: 1 } }),
      }),
    );
    expect(markup).toMatch(/<h2[^>]*>1 vehicle<\/h2>/);
  });

  test("unrestricted yard searches only suggest clearing their other filters", () => {
    const model = resolve({});
    if (model.kind !== "empty")
      throw new Error("Expected an empty result model");
    const markup = renderToStaticMarkup(
      createElement(SearchResultsPanel, {
        model: {
          ...model,
          activeFilterCount: 1,
          filters: { states: ["Alabama"], yardTypes: [] },
        },
      }),
    );
    expect(markup).toContain("Try nearby years or remove a search term");
    expect(markup).toContain("You can also clear filters");
    expect(markup).not.toContain("include more yard types");
  });

  test("the zero self-service fallback still offers full-service recovery", () => {
    const markup = renderToStaticMarkup(
      createElement(SearchResultsPanel, {
        model: resolve({}),
        fullServiceSuggestion: {
          kind: "fallback",
          selfServiceCount: 0,
          extraCount: 1,
          showThem: () => undefined,
        },
      }),
    );
    expect(markup).toContain("No self-service matches");
    expect(markup).toContain("+1 more vehicle at full-service yards");
    expect(markup).toContain("Show full-service results");
    expect(markup).not.toContain("Try nearby years");
  });

  test("distinguishes loading, error, empty, and result states", () => {
    expect(resolve({ searchResult: null, isSearching: true }).kind).toBe(
      "loading",
    );
    expect(resolve({ hasError: true }).kind).toBe("error");
    expect(resolve({}).kind).toBe("empty");
    expect(
      resolve({ searchResult: { ...emptyResult, totalCount: 1 } }).kind,
    ).toBe("results");
  });
});
