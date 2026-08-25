"use client";

import { AlertCircle } from "lucide-react";
import Link from "next/link";
import posthog from "posthog-js";
import type { ReactNode } from "react";
import {
  SaveSearchDialog,
  storePendingSaveSearch,
  type SaveSearchFilters,
} from "~/components/search/SaveSearchDialog";
import {
  SearchResults,
  SearchSummary,
} from "~/components/search/SearchResults";
import { SearchQuotaOverlay } from "~/components/search/SearchQuotaOverlay";
import { Button } from "~/components/ui/button";
import type { SearchQuotaGateState } from "~/hooks/use-daily-search-quota";
import { AnalyticsEvents } from "~/lib/analytics-events";
import type { PlanAccessState } from "~/lib/plan-access";
import type { SearchResult } from "~/lib/types";

type ClosedQuotaGate = Exclude<SearchQuotaGateState, { kind: "open" }>;

export type SearchResultsHeaderModel = {
  status:
    | { kind: "loading" }
    | {
        kind: "ready";
        totalCount: number;
        visibleCount: number | null;
        processingTimeMS: number;
      };
  actions: ReactNode;
};

interface SearchResultsListModel {
  isLoading: boolean;
  sidebarOpen: boolean;
  showMore(): void;
  isLastPage: boolean;
  isFetchingNextPage: boolean;
  lockedPreview?: { clearRows: number; overlay: ReactNode };
  visibleCount?: number;
}

interface EmptySearchResultsModel {
  activeFilterCount: number;
  clearAllFilters(): void;
  isLoggedIn: boolean;
  query: string;
  filters: SaveSearchFilters;
  planAccess: PlanAccessState;
  saveSearchSignUpHref: string;
  analyticsQuery: string;
}

export type SearchResultsPanelModel =
  | { kind: "inactive" }
  | {
      kind: "quota";
      gate: ClosedQuotaGate;
      query: string;
      isGuest: boolean;
    }
  | {
      kind: "loading";
      header: SearchResultsHeaderModel;
      list: Pick<SearchResultsListModel, "sidebarOpen" | "showMore">;
    }
  | { kind: "error" }
  | ({ kind: "empty" } & EmptySearchResultsModel)
  | {
      kind: "results";
      header: SearchResultsHeaderModel;
      searchResult: SearchResult;
      list: SearchResultsListModel;
    };

export function resolveSearchResultsPanelModel(input: {
  lifecycle: {
    hasActiveSearch: boolean;
    quotaGate: SearchQuotaGateState;
    isSearching: boolean;
    hasError: boolean;
    searchResult: SearchResult | null;
  };
  header: {
    actions: ReactNode;
    processingTimeMS: number;
    visibleCount: number | null;
  };
  quota: { query: string; isGuest: boolean };
  loading: Pick<SearchResultsListModel, "sidebarOpen" | "showMore">;
  empty: EmptySearchResultsModel;
  results: SearchResultsListModel;
}): SearchResultsPanelModel {
  const { lifecycle } = input;
  if (!lifecycle.hasActiveSearch) return { kind: "inactive" };
  if (lifecycle.quotaGate.kind !== "open") {
    return {
      kind: "quota",
      gate: lifecycle.quotaGate,
      ...input.quota,
    };
  }
  if (lifecycle.hasError && !lifecycle.isSearching) return { kind: "error" };
  if (!lifecycle.searchResult) {
    return {
      kind: "loading",
      header: { status: { kind: "loading" }, actions: input.header.actions },
      list: input.loading,
    };
  }
  if (lifecycle.searchResult.totalCount === 0 && !lifecycle.isSearching) {
    return { kind: "empty", ...input.empty };
  }
  return {
    kind: "results",
    header: {
      status: lifecycle.isSearching
        ? { kind: "loading" }
        : {
            kind: "ready",
            totalCount: lifecycle.searchResult.totalCount,
            visibleCount: input.header.visibleCount,
            processingTimeMS: input.header.processingTimeMS,
          },
      actions: input.header.actions,
    },
    searchResult: lifecycle.searchResult,
    list: input.results,
  };
}

const LOADING_RESULT: SearchResult = {
  vehicles: [],
  totalCount: 0,
  page: 1,
  hasMore: false,
  searchTime: 0,
  locationsCovered: 0,
  locationsWithErrors: [],
};

function SearchResultsHeader({ model }: { model: SearchResultsHeaderModel }) {
  return (
    <div className="mb-6">
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        {model.status.kind === "loading" ? (
          <div>
            <div className="bg-muted mb-2 h-8 w-48 animate-pulse rounded-md" />
            <div className="bg-muted h-4 w-32 animate-pulse rounded-md" />
          </div>
        ) : (
          <div>
            <h2 className="text-foreground text-2xl font-black">
              Search Results
            </h2>
            <p className="text-muted-foreground">
              {model.status.visibleCount === null
                ? `${model.status.totalCount.toLocaleString()} vehicles found`
                : `Showing ${model.status.visibleCount} of ${model.status.totalCount.toLocaleString()} vehicles`}
            </p>
          </div>
        )}
        {model.actions}
      </div>

      {model.status.kind === "loading" ? (
        <div className="mb-6 flex items-center justify-between text-sm">
          <div className="bg-muted h-4 w-48 animate-pulse rounded-md" />
        </div>
      ) : (
        <div className="text-muted-foreground mb-6 flex items-center justify-between text-sm">
          <span>Results in {model.status.processingTimeMS}ms</span>
        </div>
      )}
    </div>
  );
}

export function SearchResultsPanel({
  model,
}: {
  model: SearchResultsPanelModel;
}) {
  switch (model.kind) {
    case "inactive":
      return null;
    case "quota":
      return (
        <SearchQuotaOverlay
          gate={model.gate}
          query={model.query}
          isGuest={model.isGuest}
        />
      );
    case "loading":
      return (
        <>
          <SearchResultsHeader model={model.header} />
          <SearchResults
            searchResult={LOADING_RESULT}
            isLoading
            sidebarOpen={model.list.sidebarOpen}
            showMore={model.list.showMore}
            isLastPage
            isFetchingNextPage={false}
          />
        </>
      );
    case "error":
      return (
        <div className="py-12 text-center">
          <div className="bg-destructive/10 mx-auto mb-4 flex h-24 w-24 items-center justify-center rounded-full">
            <AlertCircle className="text-destructive h-12 w-12" />
          </div>
          <h2 className="text-foreground mb-2 text-lg font-medium">
            Search unavailable
          </h2>
          <p className="text-muted-foreground mx-auto max-w-md">
            We&apos;re having trouble connecting to search. Please try again in
            a moment.
          </p>
        </div>
      );
    case "empty":
      return (
        <div className="py-12 text-center">
          <div className="bg-muted mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full">
            <AlertCircle className="text-muted-foreground h-8 w-8" />
          </div>
          <h2 className="text-foreground mb-2 text-lg font-medium">
            No vehicles found
          </h2>
          <p className="text-muted-foreground mx-auto max-w-sm text-sm">
            {model.activeFilterCount > 0
              ? "No vehicles match your current filters. Try broadening your search."
              : "No vehicles match your search. Try different terms."}
          </p>

          {model.activeFilterCount > 0 && (
            <Button
              onClick={model.clearAllFilters}
              variant="outline"
              size="sm"
              className="mt-5"
            >
              Clear Filters
            </Button>
          )}

          <p className="text-muted-foreground mt-6 text-xs">
            {model.isLoggedIn ? (
              <SaveSearchDialog
                query={model.query}
                filters={model.filters}
                planAccess={model.planAccess}
                isLoggedIn
              />
            ) : (
              <Link
                href={model.saveSearchSignUpHref}
                className="hover:text-foreground underline underline-offset-2"
                onClick={() => {
                  storePendingSaveSearch(model.query, model.filters);
                  posthog.capture(AnalyticsEvents.RESULT_CAP_SIGNUP_CLICKED, {
                    source_page: "search",
                    cta_location: "no_results",
                    query: model.analyticsQuery,
                    result_count: 0,
                    visible_result_count: 0,
                  });
                }}
              >
                Save this search
              </Link>
            )}{" "}
            ·{" "}
            <Link
              href="/pricing"
              className="hover:text-foreground underline underline-offset-2"
              onClick={() =>
                posthog.capture(AnalyticsEvents.PRICING_CTA_CLICKED, {
                  source_page: "search",
                  cta_location: "no_results",
                  query: model.analyticsQuery,
                  result_count: 0,
                  visible_result_count: 0,
                  is_logged_in: model.isLoggedIn,
                })
              }
            >
              Get alerts
            </Link>
          </p>
        </div>
      );
    case "results":
      return (
        <>
          <SearchResultsHeader model={model.header} />
          <SearchResults searchResult={model.searchResult} {...model.list} />
          <SearchSummary
            searchResult={model.searchResult}
            visibleCount={model.list.visibleCount}
          />
        </>
      );
  }
}
