import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import SearchError from "~/app/search/error";
import { DefaultErrorFallback } from "~/components/ErrorBoundary";
import { SearchErrorFallback } from "./SearchErrorFallback";

function apiError(status: number, message: string) {
  return Object.assign(new Error(message), { name: "ApiError", status });
}
const retry = () => undefined;

describe("search error fallbacks", () => {
  test("a blocked search backend says search is down and yard pages still work", () => {
    const html = renderToStaticMarkup(
      <SearchErrorFallback
        error={apiError(403, "Application is blocked")}
        retry={retry}
      />,
    );
    expect(html).toContain("Search is temporarily unavailable");
    expect(html).toContain("Yard pages still work.");
    expect(html).toContain('href="/junkyards"');
    expect(html).not.toContain("Application is blocked");
  });

  test("/search error.tsx maps a blocked backend the same way", () => {
    const html = renderToStaticMarkup(
      <SearchError
        error={apiError(403, "Application is blocked")}
        reset={retry}
      />,
    );
    expect(html).toContain("Yard pages still work.");
  });

  test("other failures get a generic message without vendor text", () => {
    const html = renderToStaticMarkup(
      <SearchErrorFallback
        error={apiError(400, "Invalid key 1W23RR64C2")}
        retry={retry}
      />,
    );
    expect(html).toContain("Search could not load");
    expect(html).not.toContain("1W23RR64C2");
    expect(html).not.toContain('href="/junkyards"');
  });

  test("the default boundary fallback never shows the raw error message", () => {
    const html = renderToStaticMarkup(
      <DefaultErrorFallback
        error={apiError(403, "Application is blocked")}
        retry={retry}
      />,
    );
    expect(html).toContain("Something went wrong");
    expect(html).not.toContain("Application is blocked");
  });
});
