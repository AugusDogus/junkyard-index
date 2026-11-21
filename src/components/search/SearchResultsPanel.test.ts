import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { SearchFailure } from "~/lib/search-failure";
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
  failure?: SearchFailure | null;
  searchResult?: SearchResult | null;
}) {
  const showMore = () => undefined;
  return resolveSearchResultsPanelModel({
    lifecycle: {
      hasActiveSearch: true,
      isSearching: input.isSearching ?? false,
      failure: input.failure ?? null,
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

  test("the full-service hint sits in the header row beside the count", () => {
    const markup = renderToStaticMarkup(
      createElement(SearchResultsPanel, {
        model: resolve({ searchResult: { ...emptyResult, totalCount: 3 } }),
        fullServiceSuggestion: {
          kind: "hint",
          selfServiceCount: 3,
          extraCount: 84925,
          showThem: () => undefined,
        },
      }),
    );
    // The h2 column closes before the hint starts.
    expect(markup).toMatch(
      /<h2[^>]*>3 vehicles at self-service yards<\/h2><span[^>]*>Results in 10 ms<\/span><\/div><div[^>]*><p[^>]*>\+84,925 more vehicles at full-service yards\.<span class="hidden sm:inline"> They pull the parts for you, so call first\.<\/span><\/p><button[^>]*>Show full-service results<\/button><\/div>/,
    );
    expect(markup).not.toContain("py-12");
  });

  test("the full-service fallback keeps its tall block above the results", () => {
    const markup = renderToStaticMarkup(
      createElement(SearchResultsPanel, {
        model: resolve({ searchResult: { ...emptyResult, totalCount: 1 } }),
        fullServiceSuggestion: {
          kind: "fallback",
          selfServiceCount: 1,
          extraCount: 5,
          showThem: () => undefined,
        },
      }),
    );
    expect(markup).toContain("border-b py-12 sm:py-16");
    expect(markup).toContain("Only a few self-service matches");
    expect(markup).toContain(
      "+5 more vehicles at full-service yards. They pull the parts for you, so call first.",
    );
    expect(markup.match(/Show full-service results/g)?.length).toBe(1);
  });

  test("the timing reads inline after the count, capped or not", () => {
    const uncapped = renderToStaticMarkup(
      createElement(SearchResultsPanel, {
        model: resolve({ searchResult: { ...emptyResult, totalCount: 2 } }),
      }),
    );
    expect(uncapped).toMatch(
      /<h2[^>]*>2 vehicles<\/h2><span[^>]*>Results in 10 ms<\/span>/,
    );
    const model = resolve({ searchResult: { ...emptyResult, totalCount: 96 } });
    if (model.kind !== "results" || model.header.status.kind !== "ready")
      throw new Error("Expected a ready result model");
    const capped = renderToStaticMarkup(
      createElement(SearchResultsPanel, {
        model: {
          ...model,
          header: {
            ...model.header,
            status: { ...model.header.status, visibleCount: 24 },
          },
        },
      }),
    );
    expect(capped).toMatch(
      /<h2[^>]*>96 vehicles<\/h2><span[^>]*>Showing 24 · 10 ms<\/span>/,
    );
  });

  test("distinguishes loading, error, empty, and result states", () => {
    expect(resolve({ searchResult: null, isSearching: true }).kind).toBe(
      "loading",
    );
    expect(resolve({ failure: { kind: "unexpected" } })).toEqual({
      kind: "error",
      failure: { kind: "unexpected" },
    });
    expect(resolve({}).kind).toBe("empty");
    expect(
      resolve({ searchResult: { ...emptyResult, totalCount: 1 } }).kind,
    ).toBe("results");
  });
});
