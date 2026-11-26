import { expect, test } from "bun:test";
import historyRouter from "instantsearch.js/es/lib/routers/history";
import { ALGOLIA_INDEX_NAME, ALGOLIA_NEWEST_INDEX_NAME } from "~/lib/constants";
import {
  SearchAccessRouting,
  type SearchAccessRoutingOptions,
} from "./search-access-routing";

const options = (
  knownYardNames: readonly string[],
): SearchAccessRoutingOptions => ({
  vinPatternIndexReady: false,
  booleanOrSearchReady: false,
  canUseAdvancedFilters: false,
  newestSortReady: true,
  knownYardNames,
});

type Rendered = { key: string; routing: SearchAccessRouting };

// Mirrors SearchAccessShell, which memoizes its routing on the routing key.
function render(
  previous: Rendered | undefined,
  next: SearchAccessRoutingOptions,
): Rendered {
  const key = SearchAccessRouting.key(next);
  if (previous?.key === key) return previous;
  return { key, routing: SearchAccessRouting.create(next) };
}

test("a saved search opened after a server re-render updates the started search", async () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const events = new EventTarget();
  const browser = {
    location: new URL("https://example.com/search"),
    history: { length: 1 },
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events),
  };
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: browser,
  });
  const first = render(undefined, options([]));
  // InstantSearchNext builds its router once, from the first render's routing.
  const router = historyRouter({ ...first.routing.router });
  let uiState: Record<string, unknown> | undefined;
  router.onUpdate((route) => {
    uiState =
      first.routing.stateMapping.routeToState(route)[ALGOLIA_INDEX_NAME];
  });
  try {
    // router.push re-renders the server page, which sends an equal but new
    // yard-name list. The shell then reports the URL change to its routing.
    const second = render(first, options([]));
    browser.location = new URL(
      "https://example.com/search?q=Volvo&yardTypes=all&minYear=1963&maxYear=2000&sort=newest",
    );
    second.routing.onUrlChange(browser.location.href);
    await Bun.sleep(20);
    expect(uiState).toEqual({
      query: "Volvo",
      sortBy: ALGOLIA_NEWEST_INDEX_NAME,
      range: { year: "1963:2000" },
      refinementList: { yardTypes: [] },
    });

    // Back returns to the unfiltered newest-first search.
    browser.location = new URL("https://example.com/search");
    events.dispatchEvent(new Event("popstate"));
    second.routing.onUrlChange(browser.location.href);
    await Bun.sleep(20);
    expect(uiState).toEqual({
      sortBy: ALGOLIA_NEWEST_INDEX_NAME,
      refinementList: { yardTypes: ["self_service"] },
    });

    // Forward reopens the saved search.
    browser.location = new URL(
      "https://example.com/search?q=Volvo&yardTypes=all&minYear=1963&maxYear=2000&sort=newest",
    );
    events.dispatchEvent(new Event("popstate"));
    second.routing.onUrlChange(browser.location.href);
    await Bun.sleep(20);
    expect(uiState).toMatchObject({ query: "Volvo" });
  } finally {
    router.dispose();
    if (previousWindow)
      Object.defineProperty(globalThis, "window", previousWindow);
    else Reflect.deleteProperty(globalThis, "window");
  }
});

test("a changed yard-name list builds a routing for a new search instance", () => {
  expect(SearchAccessRouting.key(options(["Pull, Save"]))).not.toBe(
    SearchAccessRouting.key(options([])),
  );
});
