import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { getQueryKey } from "@trpc/react-query";
import { httpLink } from "@trpc/client";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import {
  PathnameContext,
  SearchParamsContext,
} from "next/dist/shared/lib/hooks-client-context.shared-runtime";
import { ServerInsertedHTMLContext } from "next/navigation";
import { NuqsTestingAdapter } from "nuqs/adapters/testing";
import { Suspense, useEffect, type ReactNode } from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToReadableStream, renderToStaticMarkup } from "react-dom/server";
import superjson from "superjson";
import { SearchPageContent } from "~/components/search/SearchPageContent";
import type { SearchKeyGrant } from "~/lib/search-key-grant";
import { SearchServerRender } from "~/lib/search-server-render";
import { api } from "~/trpc/react";
import { serverSearches } from "./shared-search-client";

const params = new URLSearchParams(
  typeof window === "undefined" ? process.argv[2] : window.location.search,
);
const isLoggedIn = params.get("fixtureGuest") !== "1";
// With fixtureUserAgent, the page's own decision runs on the non-fixture params.
const fixtureUserAgent = params.get("fixtureUserAgent");
const serverSearch: SearchServerRender =
  fixtureUserAgent === null
    ? "search"
    : SearchServerRender.decide({
        userAgent: fixtureUserAgent,
        params: Object.fromEntries(
          [...params].filter(([key]) => !key.startsWith("fixture")),
        ),
      });
// The server mints this per plan; the browser must search with it.
const searchKey: SearchKeyGrant = {
  apiKey: isLoggedIn ? "fixture-full-key" : "fixture-free-key",
  validUntil: 4_102_444_800,
  tier: isLoggedIn ? "full" : "free",
};
const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: Infinity, retry: false } },
});
queryClient.setQueryData(
  getQueryKey(api.status.searchCapabilities, undefined, "query"),
  {
    vinPatternSearchReady: true,
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
queryClient.setQueryData(
  getQueryKey(api.savedSearches.list, undefined, "query"),
  [],
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
const router = {
  back() {},
  forward() {},
  refresh() {},
  hmrRefresh() {},
  push() {},
  replace() {},
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

function Fixture() {
  return (
    <AppRouterContext.Provider value={router}>
      <PathnameContext.Provider value="/search">
        <SearchParamsContext.Provider value={params}>
          <NuqsTestingAdapter searchParams={params}>
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
                <Suspense>
                  <SearchPageContent
                    isLoggedIn={isLoggedIn}
                    initialIsMobile={params.get("fixtureMobile") === "1"}
                    knownYardNames={["RTP Pick-A-Part - Hebron, KY"]}
                    serverSearch={serverSearch}
                    searchKey={searchKey}
                  />
                  <HydrationMarker />
                </Suspense>
              </api.Provider>
            </QueryClientProvider>
          </NuqsTestingAdapter>
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
    `<!doctype html><html><head><meta charset="utf-8"><meta name="fixture-server-searches" content="${serverSearches.count}"></head><body><div id="root">${markup}</div>${scripts}<script>globalThis.process={env:{NODE_ENV:"production"}}</script><script type="module" src="/app.js"></script></body></html>`,
  );
} else {
  const root = document.getElementById("root");
  if (!root) throw new Error("Missing shared search fixture root.");
  // The app's real client instrumentation, so tests can end a page view the
  // way a client navigation does.
  const { onRouterTransitionStart } = await import("~/instrumentation-client");
  Reflect.set(window, "fixtureRouterTransitionStart", onRouterTransitionStart);
  hydrateRoot(root, <Fixture />);
  // Page load in browser tests means the streamed search has hydrated.
  await hydrated;
}
