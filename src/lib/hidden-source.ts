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
 * The sources hidden from the public site right now. A hidden source keeps
 * ingesting and keeps its rows, but no page, search, alert, sitemap or link
 * shows its vehicles, yards or website.
 *
 * The owner hides and shows sources from /admin (the table `source_control`),
 * and a source with no accepted publication for INVENTORY_HIDDEN_AFTER_DAYS
 * hides itself until its next one. The server reads both through
 * `loadHiddenSources` (src/server/source-control/hidden-sources.ts), and
 * browsers get the list with their search key. Every function here takes the
 * list it applies, so nothing can fall back to a stale copy. See
 * docs/runbooks/hide-source.md.
 */
export type HiddenSources = {
  /** Hidden sources in registry order, so cache keys built from it are stable. */
  readonly list: readonly IngestionSource[];
};

const none: HiddenSources = { list: [] };

/** The hidden sources among `sources`; values that name no source are dropped. */
function of(sources: Iterable<string>): HiddenSources {
  const named = new Set<string>(sources);
  return { list: INGESTION_SOURCES.filter((source) => named.has(source)) };
}

function has(hidden: HiddenSources, source: string): boolean {
  return hidden.list.some((entry) => entry === source);
}

/** An Algolia filter that matches no vehicle of these sources. */
function filterFor(sources: readonly string[]): string | undefined {
  return combineSearchFilters(
    ...sources.map((source) => `NOT source:"${source}"`),
  );
}

function and(own: string | undefined, filter: string): string {
  return own ? `${own} AND ${filter}` : filter;
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
  /** Nothing hidden. */
  none,
  of,
  has,
  /** Hidden sources and retired ones: every source public lists leave out. */
  unlisted(hidden: HiddenSources): readonly IngestionSource[] {
    return [...RETIRED_INGESTION_SOURCES, ...hidden.list];
  },
  /**
   * A saved or URL source selection without its hidden sources, so pickers
   * that offer only shown sources toggle and count it correctly.
   */
  shown<Source extends string>(
    hidden: HiddenSources,
    sources: readonly Source[],
  ): Source[] {
    return sources.filter((source) => !has(hidden, source));
  },
  filterFor,
  /** Every public search's exclusion, or undefined when nothing is hidden. */
  algoliaFilter(hidden: HiddenSources): string | undefined {
    return filterFor(hidden.list);
  },
  /** The request with the hidden sources excluded from its own filters. */
  exclude<Request extends { filters?: string | undefined }>(
    hidden: HiddenSources,
    request: Request,
  ): Request {
    const filter = filterFor(hidden.list);
    return filter === undefined
      ? request
      : { ...request, filters: and(request.filters, filter) };
  },
  /**
   * A search client's input with the hidden sources excluded from every
   * request, in every request shape and including facet searches.
   */
  excludeFromSearch(
    hidden: HiddenSources,
    input: SearchMethodParams | LegacySearchMethodProps,
  ): SearchMethodParams | LegacySearchMethodProps {
    const filter = filterFor(hidden.list);
    if (filter === undefined) return input;
    if (Array.isArray(input))
      return input.map((request) => ({
        ...request,
        params: HiddenSources.exclude(hidden, request.params ?? {}),
      }));
    return {
      ...input,
      requests: input.requests.map((request) =>
        excludeFromQuery(request, filter),
      ),
    };
  },
  /** A search client whose every request excludes the hidden sources. */
  withSearchClient<Client extends Pick<LiteClient, "search">>(
    hidden: HiddenSources,
    client: Client,
  ) {
    return {
      ...client,
      search<T>(
        input: SearchMethodParams | LegacySearchMethodProps,
        requestOptions?: Parameters<LiteClient["search"]>[1],
      ) {
        return client.search<T>(
          HiddenSources.excludeFromSearch(hidden, input),
          requestOptions,
        );
      },
    };
  },
} as const;
