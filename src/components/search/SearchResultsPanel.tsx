"use client";

import { AlertCircle } from "lucide-react";
import Link from "next/link";
import { Analytics } from "~/lib/analytics";
import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
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
import type { SearchFailure } from "~/lib/search-failure";
import { trackRequestYardClick } from "~/lib/track-request-yard-click";
import type { SearchResult } from "~/lib/types";
import { cn } from "~/lib/utils";

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
  sessionKey?: string;
  isLoading: boolean;
  showMore(): void;
  isLastPage: boolean;
  isFetchingNextPage: boolean;
  endOfResults?: ReactNode;
  staticPage?: boolean;
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
  | { kind: "error"; failure: SearchFailure }
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
    failure: SearchFailure | null;
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
  if (lifecycle.failure && !lifecycle.isSearching)
    return { kind: "error", failure: lifecycle.failure };
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

function SearchResultsHeader({
  model,
  headingRef,
  fullServiceSuggestion,
}: {
  model: SearchResultsHeaderModel;
  headingRef: RefObject<HTMLHeadingElement | null>;
  fullServiceSuggestion?: FullServiceSuggestion;
}) {
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
            <h2
              ref={headingRef}
              tabIndex={-1}
              className="text-xl font-semibold text-balance tabular-nums"
            >
              {model.status.totalCount.toLocaleString()}{" "}
              {model.status.totalCount === 1 ? "vehicle" : "vehicles"}
              {fullServiceSuggestion && " at self-service yards"}
            </h2>
            <p className="text-muted-foreground mt-1 text-sm tabular-nums">
              {model.status.visibleCount === null
                ? `Results in ${model.status.processingTimeMS} ms`
                : `Showing ${model.status.visibleCount.toLocaleString()} · ${model.status.processingTimeMS} ms`}
            </p>
            {fullServiceSuggestion?.kind === "hint" && (
              <FullServiceMessage suggestion={fullServiceSuggestion} />
            )}
          </div>
        )}
      </div>
      {model.actions}
    </div>
  );
}

export type FullServiceSuggestion = {
  kind: "hint" | "fallback";
  selfServiceCount: number;
  extraCount: number;
  showThem(): void;
};

function FullServiceMessage({
  suggestion,
}: {
  suggestion: FullServiceSuggestion;
}) {
  const fallback = suggestion.kind === "fallback";
  return (
    <div
      className={cn(
        "flex flex-col items-start",
        fallback ? "border-b py-12 sm:py-16" : "mt-3",
      )}
    >
      {fallback && (
        <h2 className="text-xl font-semibold text-balance">
          {suggestion.selfServiceCount === 0
            ? "No self-service matches"
            : "Only a few self-service matches"}
        </h2>
      )}
      <p
        className={cn(
          "text-muted-foreground max-w-md text-sm text-pretty tabular-nums",
          fallback && "mt-2",
        )}
      >
        +{suggestion.extraCount.toLocaleString()} more{" "}
        {suggestion.extraCount === 1 ? "vehicle" : "vehicles"} at full-service
        yards. They pull the parts for you, so call first.
      </p>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="mt-3 min-h-11 sm:min-h-9"
        onClick={suggestion.showThem}
      >
        Show full-service results
      </Button>
    </div>
  );
}

export function SearchResultsPanel({
  model,
  fullServiceSuggestion,
}: {
  model: SearchResultsPanelModel;
  fullServiceSuggestion?: FullServiceSuggestion;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const expansionFromCount = useRef<number | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const readyCount =
    model.kind === "results" && model.header.status.kind === "ready"
      ? model.header.status.totalCount
      : model.kind === "empty"
        ? 0
        : null;
  const suggestionCount = fullServiceSuggestion?.extraCount;
  useEffect(() => {
    setAnnouncement("");
    if (
      model.kind === "error" ||
      model.kind === "inactive" ||
      model.kind === "empty"
    ) {
      expansionFromCount.current = null;
    }
    if (readyCount === null) return;
    const expanded =
      expansionFromCount.current !== null &&
      readyCount > expansionFromCount.current;
    if (expanded) {
      expansionFromCount.current = null;
      headingRef.current?.focus({ preventScroll: true });
      headingRef.current?.scrollIntoView({ block: "center" });
    }
    const timeout = setTimeout(() => {
      const countMessage =
        readyCount === 0
          ? "No vehicles found"
          : `${readyCount.toLocaleString()} ${readyCount === 1 ? "vehicle" : "vehicles"} found`;
      if (expanded) {
        setAnnouncement(`${countMessage}. Full-service yards included.`);
      } else if (suggestionCount !== undefined) {
        setAnnouncement(
          `${countMessage} at self-service yards. ${suggestionCount.toLocaleString()} more ${suggestionCount === 1 ? "vehicle" : "vehicles"} at full-service yards.`,
        );
      } else {
        setAnnouncement(`${countMessage}.`);
      }
    }, 300);
    return () => clearTimeout(timeout);
  }, [readyCount, model.kind, suggestionCount]);
  const suggestion = fullServiceSuggestion
    ? {
        ...fullServiceSuggestion,
        showThem() {
          expansionFromCount.current = fullServiceSuggestion.selfServiceCount;
          setAnnouncement("");
          fullServiceSuggestion.showThem();
        },
      }
    : undefined;
  return (
    <>
      <p
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      >
        {announcement}
      </p>
      <SearchResultsPanelContent
        model={model}
        fullServiceSuggestion={suggestion}
        headingRef={headingRef}
      />
    </>
  );
}

function SearchResultsPanelContent({
  model,
  fullServiceSuggestion,
  headingRef,
}: {
  model: SearchResultsPanelModel;
  fullServiceSuggestion?: FullServiceSuggestion;
  headingRef: RefObject<HTMLHeadingElement | null>;
}) {
  switch (model.kind) {
    case "inactive":
      return null;
    case "loading":
      return (
        <>
          <SearchResultsHeader model={model.header} headingRef={headingRef} />
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
            {model.failure.kind === "backend_blocked" ? (
              <>
                Yard pages still work.{" "}
                <Link href="/junkyards" className="underline">
                  Browse yards
                </Link>{" "}
                while search is down. Your filters are preserved.
              </>
            ) : (
              "Your filters are preserved. Try the search again in a moment."
            )}
          </AlertDescription>
        </Alert>
      );
    case "empty":
      if (fullServiceSuggestion)
        return <FullServiceMessage suggestion={fullServiceSuggestion} />;
      return (
        <div className="flex flex-col items-start border-b py-12 sm:py-16">
          <h2 className="text-xl font-semibold text-balance">
            No vehicles found
          </h2>
          <p className="text-muted-foreground mt-2 max-w-md text-sm text-pretty">
            No vehicles match this search. Try nearby years or remove a search
            term.
            {model.activeFilterCount > 0 && (
              <>
                {" "}
                You can also clear filters
                {(model.filters.yardTypes?.length ?? 0) > 0 &&
                  " or include more yard types"}
                .
              </>
            )}
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
                  Analytics.capture(AnalyticsEvents.RESULT_CAP_SIGNUP_CLICKED, {
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
                Analytics.capture(AnalyticsEvents.PRICING_CTA_CLICKED, {
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
          {fullServiceSuggestion?.kind === "fallback" && (
            <FullServiceMessage suggestion={fullServiceSuggestion} />
          )}
          <SearchResultsHeader
            model={model.header}
            headingRef={headingRef}
            fullServiceSuggestion={fullServiceSuggestion}
          />
          <SearchResults searchResult={model.searchResult} {...model.list} />
          <SearchSummary
            searchResult={model.searchResult}
            visibleCount={model.list.visibleCount}
          />
        </>
      );
  }
}
