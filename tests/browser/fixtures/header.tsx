import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import {
  PathnameContext,
  SearchParamsContext,
} from "next/dist/shared/lib/hooks-client-context.shared-runtime";
import { Suspense } from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToReadableStream } from "react-dom/server";
import { HeaderContent } from "~/components/HeaderContent";

const location = new URL(
  typeof window === "undefined"
    ? (process.argv[2] ?? "/")
    : window.location.href,
  "http://header.test",
);
const user = { name: "Header Test", email: "header@example.com" };
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
      <PathnameContext.Provider value={location.pathname}>
        <SearchParamsContext.Provider value={location.searchParams}>
          <Suspense>
            <HeaderContent
              auth={{
                kind: "server",
                user: location.searchParams.has("signed-in") ? user : null,
              }}
            />
          </Suspense>
          <main id="main-content" tabIndex={-1}>
            <h1>Inventory</h1>
            <a href="/vehicle">First content link</a>
          </main>
        </SearchParamsContext.Provider>
      </PathnameContext.Provider>
    </AppRouterContext.Provider>
  );
}

if (typeof document === "undefined") {
  const stream = await renderToReadableStream(<Fixture />);
  await stream.allReady;
  console.log(await new Response(stream).text());
} else {
  const root = document.querySelector("#root");
  if (root) hydrateRoot(root, <Fixture />);
}
