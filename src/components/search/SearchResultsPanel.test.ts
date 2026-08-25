import { describe, expect, test } from "bun:test";
import type { SearchQuotaGateState } from "~/hooks/use-daily-search-quota";
import type { SearchResult } from "~/lib/types";
import { resolveSearchResultsPanelModel } from "./SearchResultsPanel";

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
  quotaGate?: SearchQuotaGateState;
  isSearching?: boolean;
  hasError?: boolean;
  searchResult?: SearchResult | null;
}) {
  const showMore = () => undefined;
  return resolveSearchResultsPanelModel({
    lifecycle: {
      hasActiveSearch: true,
      quotaGate: input.quotaGate ?? { kind: "open" },
      isSearching: input.isSearching ?? false,
      hasError: input.hasError ?? false,
      searchResult:
        "searchResult" in input ? (input.searchResult ?? null) : emptyResult,
    },
    header: { actions: null, processingTimeMS: 10, visibleCount: null },
    quota: { query: "honda", isGuest: false },
    loading: { sidebarOpen: false, showMore },
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
      sidebarOpen: false,
      showMore,
      isLastPage: true,
      isFetchingNextPage: false,
    },
  });
}

describe("search results state", () => {
  test("quota denial supersedes empty and error states", () => {
    expect(
      resolve({
        quotaGate: { kind: "limit_exceeded" },
        hasError: true,
      }),
    ).toEqual({
      kind: "quota",
      gate: { kind: "limit_exceeded" },
      query: "honda",
      isGuest: false,
    });
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
