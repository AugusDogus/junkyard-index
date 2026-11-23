import type {
  LegacySearchMethodProps,
  LiteClient,
  SearchMethodParams,
  SearchQuery,
} from "algoliasearch/lite";
import { combineSearchFilters } from "./compile-search-expression";
import {
  INGESTION_SOURCES,
  RETIRED_INGESTION_SOURCES,
  type IngestionSource,
} from "./ingestion-source";

/**
 * Sources hidden from the public site, with why. A hidden source keeps
 * ingesting and keeps its rows, but no page, search, alert, sitemap or link
 * shows its vehicles, yards or website. Remove its entry to show it again.
 * See docs/runbooks/hide-source.md.
 */
const HIDDEN_SOURCES: Readonly<Partial<Record<IngestionSource, string>>> = {
  meeks:
    "Since 2026-11-22 every meeksrecycling.com page serves an unrelated page that redirects visitors to another site.",
};

const list: readonly IngestionSource[] = INGESTION_SOURCES.filter(
  (source) => HIDDEN_SOURCES[source] !== undefined,
);

/** An Algolia filter that matches no vehicle of these sources. */
function filterFor(sources: readonly string[]): string | undefined {
  return combineSearchFilters(
    ...sources.map((source) => `NOT source:"${source}"`),
  );
}

const algoliaFilter = filterFor(list);

const unlisted: readonly IngestionSource[] = [
  ...RETIRED_INGESTION_SOURCES,
  ...list,
];

function and(own: string | undefined, filter: string): string {
  return own ? `${own} AND ${filter}` : filter;
}

/** The request with the hidden sources excluded from its own filters. */
function exclude<Request extends { filters?: string | undefined }>(
  request: Request,
): Request {
  return algoliaFilter === undefined
    ? request
    : { ...request, filters: and(request.filters, algoliaFilter) };
}

/** A URL-encoded parameter string with `filter` added to its filters. */
function excludeFromParams(params: string, filter: string): string {
  const entries = [...new URLSearchParams(params)];
  const own = entries.find(([key]) => key === "filters")?.[1];
  const filters: [string, string] = ["filters", and(own, filter)];
  return [...entries.filter(([key]) => key !== "filters"), filters]
    .map(
      ([key, value]) =>
        `${encodeURIComponent(key)}=${encodeURIComponent(value)}`,
    )
    .join("&");
}

/** A flat request, whose parameters may also come as one encoded string. */
function excludeFromQuery(request: SearchQuery, filter: string): SearchQuery {
  if ("params" in request && typeof request.params === "string")
    return { ...request, params: excludeFromParams(request.params, filter) };
  return {
    ...request,
    filters: and("filters" in request ? request.filters : undefined, filter),
  };
}

export const HiddenSources = {
  list,
  /** Hidden sources and retired ones: every source public lists leave out. */
  unlisted,
  has(source: string): boolean {
    return list.some((hidden) => hidden === source);
  },
  /**
   * A saved or URL source selection without its hidden sources, so pickers
   * that offer only shown sources toggle and count it correctly.
   */
  shown<Source extends string>(sources: readonly Source[]): Source[] {
    return sources.filter((source) => !HiddenSources.has(source));
  },
  filterFor,
  /** Every public search's exclusion, or undefined when nothing is hidden. */
  algoliaFilter,
  exclude,
  /**
   * A search client whose every request, in every request shape and
   * including facet searches, excludes the hidden sources.
   */
  withSearchClient<Client extends Pick<LiteClient, "search">>(client: Client) {
    return {
      ...client,
      search<T>(
        input: SearchMethodParams | LegacySearchMethodProps,
        requestOptions?: Parameters<LiteClient["search"]>[1],
      ) {
        const filter = algoliaFilter;
        if (filter === undefined)
          return client.search<T>(input, requestOptions);
        return client.search<T>(
          Array.isArray(input)
            ? input.map((request) => ({
                ...request,
                params: exclude(request.params ?? {}),
              }))
            : {
                ...input,
                requests: input.requests.map((request) =>
                  excludeFromQuery(request, filter),
                ),
              },
          requestOptions,
        );
      },
    };
  },
} as const;
