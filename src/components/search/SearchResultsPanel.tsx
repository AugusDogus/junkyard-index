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
import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { Skeleton } from "~/components/ui/skeleton";
import { AnalyticsEvents } from "~/lib/analytics-events";
import type { PlanAccessState } from "~/lib/plan-access";
import { trackRequestYardClick } from "~/lib/track-request-yard-click";
import type { SearchResult } from "~/lib/types";

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
      kind: "loading";
      header: SearchResultsHeaderModel;
      list: Pick<SearchResultsListModel, "showMore">;
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
    isSearching: boolean;
    hasError: boolean;
    searchResult: SearchResult | null;
  };
  header: {
    actions: ReactNode;
    processingTimeMS: number;
    visibleCount: number | null;
  };
  loading: Pick<SearchResultsListModel, "showMore">;
  empty: EmptySearchResultsModel;
  results: SearchResultsListModel;
}): SearchResultsPanelModel {
  const { lifecycle } = input;
  if (!lifecycle.hasActiveSearch) return { kind: "inactive" };
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
    <div className="mb-5 flex min-h-12 items-end justify-between gap-4 border-b pb-4">
      <div className="min-w-0">
        {model.status.kind === "loading" ? (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-6 w-40" />
            <Skeleton className="h-4 w-28" />
          </div>
        ) : (
          <div>
            <h2 className="truncate text-xl font-semibold text-balance">
              {model.status.totalCount.toLocaleString()} vehicles
            </h2>
            <p className="text-muted-foreground mt-1 text-sm tabular-nums">
              {model.status.visibleCount === null
                ? `Results in ${model.status.processingTimeMS} ms`
                : `Showing ${model.status.visibleCount.toLocaleString()} · ${model.status.processingTimeMS} ms`}
            </p>
          </div>
        )}
      </div>
      {model.actions}
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
    case "loading":
      return (
        <>
          <SearchResultsHeader model={model.header} />
          <SearchResults
            searchResult={LOADING_RESULT}
            isLoading
            showMore={model.list.showMore}
            isLastPage
            isFetchingNextPage={false}
          />
        </>
      );
    case "error":
      return (
        <Alert variant="destructive" className="my-8">
          <AlertCircle />
          <AlertTitle>Search is temporarily unavailable</AlertTitle>
          <AlertDescription>
            Your filters are preserved. Try the search again in a moment.
          </AlertDescription>
        </Alert>
      );
    case "empty":
      return (
        <div className="flex flex-col items-start border-b py-12 sm:py-16">
          <h2 className="text-xl font-semibold text-balance">
            No vehicles found
          </h2>
          <p className="text-muted-foreground mt-2 max-w-md text-sm text-pretty">
            {model.activeFilterCount > 0
              ? "No vehicles match this query and filter set. Clear the filters to broaden the search."
              : "No vehicles match this query. Check the spelling or try fewer details."}
          </p>

          {model.activeFilterCount > 0 && (
            <Button
              onClick={model.clearAllFilters}
              variant="outline"
              size="sm"
              className="mt-5"
            >
              Clear filters
            </Button>
          )}

          <p className="text-muted-foreground mt-8 text-xs">
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
            <span aria-hidden="true"> · </span>
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

          <p className="text-muted-foreground mt-2 text-xs text-pretty">
            Missing a salvage yard?{" "}
            <Link
              href="/request-yard"
              className="hover:text-foreground underline underline-offset-2"
              onClick={() =>
                trackRequestYardClick({
                  location: "no_results",
                  query: model.analyticsQuery,
                })
              }
            >
              Request it
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
