import { expect, test } from "bun:test";
import { createSearchRouteSync } from "../search-route-sync";

test("does not replay an older history write over a newer search", () => {
  let url = "https://example.com/search";
  let query = "toyota venza";
  const sync = createSearchRouteSync((nextUrl) => {
    url = nextUrl;
  });
  sync.start(() => {
    query = new URL(url).searchParams.get("q") ?? "";
  });

  sync.push("https://example.com/search?q=toyota+venza");
  query = "h";
  sync.onUrlChange(url);
  sync.onUrlChange(url);

  expect(query).toBe("h");
  sync.push("https://example.com/search?q=h");
  expect(new URL(url).searchParams.get("q")).toBe("h");
});

test("applies external navigation and clears the old write marker", () => {
  let updates = 0;
  const sync = createSearchRouteSync(() => {});
  sync.start(() => {
    updates += 1;
  });
  sync.push("https://example.com/search?q=toyota");
  sync.onUrlChange("https://example.com/search");
  sync.onUrlChange("https://example.com/search?q=toyota");
  expect(updates).toBe(2);
});

test("stops notifying the disposed router", () => {
  let updates = 0;
  const sync = createSearchRouteSync(() => {});
  sync.start(() => {
    updates += 1;
  });
  sync.dispose();
  sync.onUrlChange("https://example.com/search?q=honda");
  expect(updates).toBe(0);
});
