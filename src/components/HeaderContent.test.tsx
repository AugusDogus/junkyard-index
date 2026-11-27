import { expect, test } from "bun:test";
import {
  PathnameContext,
  SearchParamsContext,
} from "next/dist/shared/lib/hooks-client-context.shared-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import { HeaderContent } from "./HeaderContent";
import { DiscordIcon } from "./ui/icons";

function renderHeader(pathname: string, query = "") {
  return renderToStaticMarkup(
    <PathnameContext.Provider value={pathname}>
      <SearchParamsContext.Provider value={new URLSearchParams(query)}>
        <HeaderContent auth={{ kind: "server", user: null }} />
      </SearchParamsContext.Provider>
    </PathnameContext.Provider>,
  );
}

test("every header has pricing, sign in, and search", () => {
  for (const path of [
    "/",
    "/junkyards/texas",
    "/pricing",
    "/auth/sign-in",
    "/search",
  ]) {
    const html = renderHeader(path);
    expect(html).toContain('href="/pricing"');
    expect(html).toContain(">Sign in</a>");
    expect(html).toContain('href="/search"');
    expect(html).not.toContain("hidden sm:inline-flex");
    expect(html).toContain('href="#main-content"');
    expect(html).toContain("Skip to content");
  }
});

test("search marks its own nav link as the current page", () => {
  const html = renderHeader("/search", "q=Saab");
  expect(html).toMatch(
    /aria-current="page"[^>]*href="\/search"|href="\/search"[^>]*aria-current="page"/,
  );
  expect(renderHeader("/cars")).not.toMatch(
    /href="\/search"[^>]*aria-current|aria-current[^>]*href="\/search"/,
  );
});

test("header sign in preserves the current path and all query parameters", () => {
  const html = renderHeader(
    "/search",
    "q=Saab&states%5B%5D=Texas&saveSearch=1",
  );
  const destination = "/search?q=Saab&states%5B%5D=Texas&saveSearch=1";
  expect(html).toContain(
    `href="/auth/sign-in?returnTo=${encodeURIComponent(destination)}"`,
  );
});

test("auth header sign in retains the checked destination rather than nesting auth routes", () => {
  const html = renderHeader(
    "/auth/sign-up",
    "returnTo=%2Fsearch%3Fq%3DSaab%26saveSearch%3D1",
  );
  expect(html).toContain(
    'href="/auth/sign-in?returnTo=%2Fsearch%3Fq%3DSaab%26saveSearch%3D1"',
  );
});

test("Discord's decorative icon is hidden from assistive technology", () => {
  const html = renderToStaticMarkup(<DiscordIcon />);
  expect(html).toContain('aria-hidden="true"');
  expect(html).not.toContain('role="img"');
});

test("the main links include the chains hub", () => {
  expect(renderHeader("/")).toMatch(/href="\/chains"[^>]*>Chains<\/a>/);
  expect(renderHeader("/chains/pick-n-pull")).toMatch(
    /aria-current="true"[^>]*href="\/chains"|href="\/chains"[^>]*aria-current="true"/,
  );
});
