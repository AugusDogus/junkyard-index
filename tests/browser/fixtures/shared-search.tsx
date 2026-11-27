import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { getQueryKey } from "@trpc/react-query";
import { httpLink } from "@trpc/client";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import {
  PathnameContext,
  SearchParamsContext,
} from "next/dist/shared/lib/hooks-client-context.shared-runtime";
import Link from "next/link";
import { ServerInsertedHTMLContext } from "next/navigation";
import { NuqsAdapter } from "nuqs/adapters/next/app";
import { SearchUrlOrder } from "~/lib/search-url-order";
import {
  startTransition,
  Suspense,
  useEffect,
  useInsertionEffect,
  useState,
  type ReactNode,
} from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToReadableStream, renderToStaticMarkup } from "react-dom/server";
import superjson from "superjson";
import { SearchPageBody } from "~/components/search/SearchPageBody";
import { SearchPageContent } from "~/components/search/SearchPageContent";
import type { SearchKeyGrant } from "~/lib/search-key-grant";
import { SearchServerRender } from "~/lib/search-server-render";
import { api, type RouterOutputs } from "~/trpc/react";
import {
  FixtureAppRouter,
  type FixtureNavigation,
} from "./next-app-router-instance";
import { serverSearches } from "./shared-search-client";

const params = new URLSearchParams(
  typeof window === "undefined" ? process.argv[2] : window.location.search,
);
const arrivalReferenceTime =
  typeof document === "undefined"
    ? Date.now()
    : Number(document.documentElement.dataset.arrivalReferenceTime);
// fixtureLinkTo renders a Next Link to that URL. fixtureLinks=1 renders one
// of each kind of link the search page must leave alone.
const fixtureLinkTo = params.get("fixtureLinkTo");
const fixtureLinks = params.get("fixtureLinks") === "1";
const knownYardNames = ["RTP Pick-A-Part - Hebron, KY"];
const isLoggedIn = params.get("fixtureGuest") !== "1";
// With fixtureUserAgent, the page's own decision runs on the non-fixture params.
const fixtureUserAgent = params.get("fixtureUserAgent");
const serverSearch: SearchServerRender =
  fixtureUserAgent === null
    ? "search"
    : SearchServerRender.decide({
        userAgent: fixtureUserAgent,
        visitor: isLoggedIn ? "signed-in" : "guest",
        params: Object.fromEntries(
          [...params].filter(([key]) => !key.startsWith("fixture")),
        ),
      });
// The server mints this per plan; the browser must search with it.
// fixtureKeyTier=free mints a free key for a paid page, as when the server
// could not confirm the plan; fixtureKey=expired renders an expired key, so
// the browser must fetch one before it can search; fixtureKey=rejected
// renders a key Algolia refuses, as when it expired early on Algolia's clock.
const keyTier =
  !isLoggedIn ||
  params.get("fixturePlan") === "free" ||
  params.get("fixtureKeyTier") === "free"
    ? "free"
    : "full";
const searchKey: SearchKeyGrant = {
  apiKey:
    params.get("fixtureKey") === "rejected"
      ? "fixture-rejected-key"
      : `fixture-${keyTier}-key`,
  expiresInSeconds: params.get("fixtureKey") === "expired" ? 0 : 3600,
  tier: keyTier,
  hiddenSources: [],
};
const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: Infinity, retry: false } },
});
queryClient.setQueryData(
  getQueryKey(api.status.searchCapabilities, undefined, "query"),
  {
    vinPatternSearchReady: true,
    makeAliasesReady: true,
    newestSortReady: params.get("fixtureNewestReady") !== "0",
    booleanOrSearchReady: params.get("fixtureBooleanReady") !== "0",
  },
);
// fixturePlan=free signs in an account without a paid subscription.
// fixturePlan=pending or =unavailable leaves the plan to the network, which
// the test holds open or fails.
const fixturePlan = params.get("fixturePlan");
if (fixturePlan !== "pending" && fixturePlan !== "unavailable")
  queryClient.setQueryData(
    getQueryKey(api.subscription.getAccountOverview, undefined, "query"),
    fixturePlan === "free"
      ? { kind: "none" }
      : { kind: "active", tier: "full" },
  );
// Filter options come from Turso; this make and yard have no search results.
// fixtureOptions=pending or =failed leaves them to the network, which the
// test holds open or fails.
if (!params.has("fixtureOptions"))
  queryClient.setQueryData(
    getQueryKey(api.search.filterOptions, undefined, "query"),
    {
      makes: ["Ford", "Saab", "Toyota"],
      colors: ["Red"],
      states: ["Alabama", "California"],
      salvageYards: ["Fixture yard", "Turso-only yard"],
    },
  );
queryClient.setQueryData(
  getQueryKey(api.user.getLocationPreference, undefined, "query"),
  { hasPreference: false },
);
// fixtureSaved=1 gives the account one saved search, so Saved shows.
const savedSearches: RouterOutputs["savedSearches"]["list"] =
  params.get("fixtureSaved") === "1"
    ? [
        {
          id: "saved-venza",
          userId: "test-user",
          name: "Venza donor",
          query: "venza",
          filters: {},
          emailAlertsEnabled: false,
          discordAlertsEnabled: false,
          searchMatchVersion: 1,
          emailConfigVersion: 1,
          discordConfigVersion: 1,
          emailStartSequence: 0,
          discordStartSequence: 0,
          lastMatchedPublicationSequence: 0,
          lastCheckedAt: null,
          alertQuarantinedAt: null,
          alertQuarantineReason: null,
          processingLock: null,
          createdAt: new Date(0),
          updatedAt: new Date(0),
        },
      ]
    : [];
queryClient.setQueryData(
  getQueryKey(api.savedSearches.list, undefined, "query"),
  savedSearches,
);
queryClient.setQueryData(
  getQueryKey(api.user.getNotificationSettings, undefined, "query"),
  {},
);
const trpcClient = api.createClient({
  links: [
    httpLink({ url: "http://unused.test/api/trpc", transformer: superjson }),
  ],
});
// Set once the fixture mounts: commits a navigation to another /search URL.
let navigateSearch = (_navigation: FixtureNavigation) => {};
// Set in the browser: the app's real onRouterTransitionStart.
let routerTransitionStart = (_href: string, _type: "push" | "replace") => {};
/** How long the fixture's server takes to answer a client navigation. */
const NAVIGATION_RESPONSE_MS = 200;
// The navigation the router is waiting on the server for.
let pendingNavigation: FixtureNavigation | null = null;
function record(
  key: "routerPushes" | "routerNavigations" | "discardedNavigations",
  entry: unknown,
) {
  const entries: unknown = JSON.parse(
    document.documentElement.dataset[key] ?? "[]",
  );
  document.documentElement.dataset[key] = JSON.stringify([
    ...(Array.isArray(entries) ? entries : []),
    entry,
  ]);
}
/**
 * Like Next's router (app-router-instance.ts, action-queue.ts): it reports a
 * navigation to onRouterTransitionStart, then commits it once the server
 * answers, unless a history write it did not make, or Back or Forward, lands
 * first and discards it. routerNavigations records each one committed;
 * only /search renders here, so another page leaves this one as it is.
 */
function startNavigation(navigation: FixtureNavigation) {
  const started = {
    ...navigation,
    href: new URL(navigation.href, window.location.href).href,
  };
  routerTransitionStart(navigation.href, navigation.type);
  pendingNavigation = started;
  setTimeout(() => {
    if (pendingNavigation !== started) return;
    pendingNavigation = null;
    record("routerNavigations", started);
    if (new URL(started.href).pathname === "/search") navigateSearch(started);
    if (started.scroll) window.scrollTo(0, 0);
  }, NAVIGATION_RESPONSE_MS);
}
function discardNavigation() {
  if (pendingNavigation) record("discardedNavigations", pendingNavigation);
  pendingNavigation = null;
}
FixtureAppRouter.onNavigate(startNavigation);
// push also records each push the page itself makes, for tests to read.
const router = {
  back() {},
  forward() {},
  refresh() {},
  hmrRefresh() {},
  push(href: string, options?: { scroll?: boolean }) {
    record("routerPushes", href);
    startNavigation({ href, type: "push", scroll: options?.scroll ?? true });
  },
  replace(href: string, options?: { scroll?: boolean }) {
    startNavigation({ href, type: "replace", scroll: options?.scroll ?? true });
  },
  async prefetch() {},
};

let signalHydrated = () => {};
const hydrated = new Promise<void>((resolve) => {
  signalHydrated = resolve;
});
function HydrationMarker() {
  useEffect(() => {
    signalHydrated();
  }, []);
  return null;
}

/** Next marks the history entries it owns with `__NA` (app-router.js). */
const nextHistoryState = { __NA: true };
function isNextHistoryState(state: unknown) {
  return typeof state === "object" && state !== null && "__NA" in state;
}

/** The router's state: its URL, and the server props rendered for it. */
type FixtureRoute = {
  params: URLSearchParams;
  /** push for a navigation the router starts, as a Link click does. */
  history: "push" | "replace";
  /** The server's clock, which each page it renders reads anew. */
  arrivalReferenceTime: number;
};

function Fixture() {
  const [route, setRoute] = useState<FixtureRoute>({
    params,
    history: "replace",
    arrivalReferenceTime,
  });
  // Like Next's HistoryUpdater: every committed router state writes its URL
  // back, over any write the router did not see, before layout effects run.
  useInsertionEffect(() => {
    const url = `/search?${route.params.toString()}`;
    if (
      route.history === "push" &&
      url !== `${window.location.pathname}${window.location.search}`
    )
      window.history.pushState(nextHistoryState, "", url);
    else window.history.replaceState(nextHistoryState, "", url);
  }, [route]);
  useEffect(() => {
    const navigate = (url: string) =>
      setRoute((current) => ({
        params: new URL(url, window.location.href).searchParams,
        history: "replace",
        arrivalReferenceTime: current.arrivalReferenceTime,
      }));
    // The server renders the page again for the new URL, with its own clock.
    navigateSearch = ({ href, type }) =>
      startTransition(() =>
        setRoute({
          params: new URL(href).searchParams,
          history: type,
          arrivalReferenceTime: Date.now(),
        }),
      );
    // Like Next's onPopState, Back and Forward commit in a transition, so
    // other popstate listeners (such as nuqs resetting its queue) run first.
    const traverse = () => {
      discardNavigation();
      startTransition(() => navigate(window.location.href));
    };
    window.addEventListener("popstate", traverse);
    // Like Next's app router: a write carrying Next's own state (as the
    // InstantSearch router's writes do) is not seen; any other write (as
    // nuqs makes) becomes the router's URL once its transition commits.
    const { pushState, replaceState } = window.history;
    for (const [method, original] of [
      ["pushState", pushState],
      ["replaceState", replaceState],
    ] as const)
      window.history[method] = (
        data: unknown,
        unused: string,
        url?: string | URL | null,
      ) => {
        if (isNextHistoryState(data))
          return original.call(window.history, data, unused, url);
        original.call(window.history, nextHistoryState, unused, url);
        discardNavigation();
        const href = url ? String(url) : window.location.href;
        startTransition(() => navigate(href));
      };
    return () => {
      window.removeEventListener("popstate", traverse);
      window.history.pushState = pushState;
      window.history.replaceState = replaceState;
    };
  }, []);
  return (
    <AppRouterContext.Provider value={router}>
      <PathnameContext.Provider value="/search">
        <SearchParamsContext.Provider value={route.params}>
          <NuqsAdapter processUrlSearchParams={SearchUrlOrder.apply}>
            <QueryClientProvider client={queryClient}>
              <api.Provider client={trpcClient} queryClient={queryClient}>
                <button
                  type="button"
                  onClick={() =>
                    queryClient.setQueryData(
                      getQueryKey(
                        api.status.searchCapabilities,
                        undefined,
                        "query",
                      ),
                      {
                        vinPatternSearchReady: false,
                        booleanOrSearchReady: false,
                      },
                    )
                  }
                >
                  Reload capabilities
                </button>
                <button
                  type="button"
                  onClick={() =>
                    queryClient.setQueryData(
                      getQueryKey(
                        api.subscription.getAccountOverview,
                        undefined,
                        "query",
                      ),
                      { kind: "none" },
                    )
                  }
                >
                  Switch plan
                </button>
                {fixtureLinkTo !== null && (
                  <Link href={fixtureLinkTo}>Fixture link</Link>
                )}
                {fixtureLinks && (
                  <nav aria-label="Fixture links">
                    <Link href="/pricing">Pricing link</Link>
                    <Link href="/search?q=replaced" replace>
                      Replace link
                    </Link>
                    <Link
                      href="/search?q=pagination&sort=oldest"
                      scroll={false}
                    >
                      Keep scroll link
                    </Link>
                    <Link href="/pricing" target="_blank">
                      New tab link
                    </Link>
                    {/* A route outside the app router, as /api/* is. */}
                    <a href="/api/fixture-export">Plain link</a>
                  </nav>
                )}
                {/* The same body src/app/search/page.tsx renders. */}
                <SearchPageBody>
                  <Suspense>
                    <SearchPageContent
                      arrivalReferenceTime={route.arrivalReferenceTime}
                      isLoggedIn={isLoggedIn}
                      initialIsMobile={params.get("fixtureMobile") === "1"}
                      knownYardNames={knownYardNames}
                      serverSearch={serverSearch}
                      searchKey={searchKey}
                      inventoryCheck={{
                        dates: { sources: {}, yards: {} },
                        now: route.arrivalReferenceTime,
                      }}
                    />
                    <HydrationMarker />
                  </Suspense>
                </SearchPageBody>
              </api.Provider>
            </QueryClientProvider>
          </NuqsAdapter>
        </SearchParamsContext.Provider>
      </PathnameContext.Provider>
    </AppRouterContext.Provider>
  );
}

if (typeof document === "undefined") {
  const inserted: (() => ReactNode)[] = [];
  const stream = await renderToReadableStream(
    <ServerInsertedHTMLContext.Provider
      value={(callback) => inserted.push(callback)}
    >
      <Fixture />
    </ServerInsertedHTMLContext.Provider>,
  );
  const markup = await new Response(stream).text();
  const scripts = inserted
    .map((callback) => renderToStaticMarkup(<>{callback()}</>))
    .join("");
  process.stdout.write(
    `<!doctype html><html data-arrival-reference-time="${arrivalReferenceTime}"><head><meta charset="utf-8"><meta name="fixture-server-searches" content="${serverSearches.count}"></head><body><div id="root">${markup}</div>${scripts}<script>globalThis.process={env:{NODE_ENV:"production"}}</script><script type="module" src="/app.js"></script></body></html>`,
  );
} else {
  const root = document.getElementById("root");
  if (!root) throw new Error("Missing shared search fixture root.");
  // The app's real client instrumentation, so tests can end a page view the
  // way a client navigation does.
  const { onRouterTransitionStart } = await import("~/instrumentation-client");
  routerTransitionStart = onRouterTransitionStart;
  Reflect.set(window, "fixtureRouterTransitionStart", onRouterTransitionStart);
  hydrateRoot(root, <Fixture />);
  // Page load in browser tests means the streamed search has hydrated.
  await hydrated;
}
