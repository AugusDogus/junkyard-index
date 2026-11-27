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

/**
 * The links each header renders with their prefetch setting, in a child
 * process with next/link mocked so the mock stays out of other test files.
 */
async function headerLinkPrefetch(): Promise<unknown> {
  const child = Bun.spawn(
    [
      process.execPath,
      "--eval",
      `
      import { mock } from "bun:test";
      import { createElement } from "react";
      import { renderToStaticMarkup } from "react-dom/server";
      import { PathnameContext, SearchParamsContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime";
      const links = [];
      mock.module("next/link", () => ({
        default: ({ href, prefetch, children }) => {
          links.push({ href, prefetch: prefetch ?? "default" });
          return createElement("a", { href }, children);
        },
      }));
      const { HeaderContent } = await import(${JSON.stringify(new URL("./HeaderContent.tsx", import.meta.url).pathname)});
      renderToStaticMarkup(
        createElement(PathnameContext.Provider, { value: "/junkyards" },
          createElement(SearchParamsContext.Provider, { value: new URLSearchParams() },
            createElement(HeaderContent, { auth: { kind: "server", user: null } }))),
      );
      process.stdout.write(JSON.stringify(Object.fromEntries(links.map((link) => [link.href, link.prefetch]))) + "\\n");
    `,
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  const [output, errors, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (exitCode !== 0) throw new Error(`child exited ${exitCode}: ${errors}`);
  const parsed: unknown = JSON.parse(output.trim().split("\n").at(-1) ?? "");
  return parsed;
}

test("the header's search link doesn't prefetch the search page, which renders on every request", async () => {
  // Every page view would otherwise run a search render nobody may open.
  // The other main links are cached pages, so prefetching them is free.
  expect(await headerLinkPrefetch()).toEqual({
    "/": "default",
    "/junkyards": "default",
    "/map": "default",
    "/cars": "default",
    "/pricing": "default",
    "/search": false,
    "/auth/sign-in?returnTo=%2Fjunkyards": "default",
  });
});
