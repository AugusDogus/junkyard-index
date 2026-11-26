import { createSearchRouting } from "~/components/search/search-routing";
import { ALGOLIA_INDEX_NAME } from "~/lib/constants";
import { createSearchRouteSync } from "~/lib/search-route-sync";

export interface SearchAccessRoutingOptions {
  vinPatternIndexReady: boolean;
  booleanOrSearchReady: boolean;
  canUseAdvancedFilters: boolean;
  newestSortReady: boolean;
  knownYardNames: readonly string[];
}

export type SearchAccessRouting = ReturnType<typeof create>;

/**
 * Compares routing inputs by value. InstantSearchNext keeps the router from
 * its first render, so a routing rebuilt for equal inputs (such as the fresh
 * yard-name list every server re-render sends) would receive URL changes its
 * started router never sees.
 */
function key(options: SearchAccessRoutingOptions): string {
  return JSON.stringify([
    options.vinPatternIndexReady,
    options.booleanOrSearchReady,
    options.canUseAdvancedFilters,
    options.newestSortReady,
    options.knownYardNames,
  ]);
}

function create({
  vinPatternIndexReady,
  canUseAdvancedFilters,
  newestSortReady,
  knownYardNames,
}: SearchAccessRoutingOptions) {
  const config = createSearchRouting(
    ALGOLIA_INDEX_NAME,
    vinPatternIndexReady,
    canUseAdvancedFilters,
    { knownYardNames, newestSortReady },
  );
  const sync = createSearchRouteSync(config.router.push);
  const routeKey = (url: string) =>
    JSON.stringify(
      config.stateMapping.routeToState(
        config.router.parseURL({ location: new URL(url) }),
      ),
    );
  // SSR already used this route. Later capability/plan remounts must replay
  // it because preserveSharedStateOnUnmount can retain incompatible facets.
  let lastRouteKey =
    typeof window !== "undefined" &&
    Reflect.has(window, Symbol.for("InstantSearchInitialResults"))
      ? routeKey(window.location.href)
      : undefined;
  return {
    ...config,
    router: {
      ...config.router,
      push(url: string) {
        lastRouteKey = routeKey(url);
        sync.push(url);
      },
      start: sync.start,
      dispose: sync.dispose,
    },
    onUrlChange(url: string) {
      const key = routeKey(url);
      // Window and radius already update Configure. Replaying an unchanged
      // routed search here would issue a second identical results request.
      if (lastRouteKey === key) return;
      lastRouteKey = key;
      sync.onUrlChange(url);
    },
  };
}

export const SearchAccessRouting = { key, create } as const;
