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
import { Suspense, type ReactNode } from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToReadableStream, renderToStaticMarkup } from "react-dom/server";
import superjson from "superjson";
import { SearchPageContent } from "~/components/search/SearchPageContent";
import { api } from "~/trpc/react";

const params = new URLSearchParams(
  typeof window === "undefined" ? process.argv[2] : window.location.search,
);
const isLoggedIn = params.get("fixtureGuest") !== "1";
const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: Infinity, retry: false } },
});
queryClient.setQueryData(
  getQueryKey(api.status.searchCapabilities, undefined, "query"),
  {
    vinPatternSearchReady: true,
    booleanOrSearchReady: params.get("fixtureBooleanReady") !== "0",
  },
);
queryClient.setQueryData(
  getQueryKey(api.subscription.getAccountOverview, undefined, "query"),
  {
    kind: "active",
    tier: "full",
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
                  <SearchPageContent isLoggedIn={isLoggedIn} />
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
    `<!doctype html><html><head><meta charset="utf-8"></head><body><div id="root">${markup}</div>${scripts}<script>globalThis.process={env:{NODE_ENV:"production"}}</script><script type="module" src="/app.js"></script></body></html>`,
  );
} else {
  const root = document.getElementById("root");
  if (!root) throw new Error("Missing shared search fixture root.");
  hydrateRoot(root, <Fixture />);
}
