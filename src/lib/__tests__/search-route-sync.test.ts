import { expect, test } from "bun:test";
import historyRouter from "instantsearch.js/es/lib/routers/history";
import { createSearchRouting } from "~/components/search/search-routing";
import { createSearchRouteSync } from "../search-route-sync";

test("does not replay an older history write over a newer search", async () => {
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

  await Bun.sleep(20);
  expect(query).toBe("h");
  sync.push("https://example.com/search?q=h");
  expect(new URL(url).searchParams.get("q")).toBe("h");
});

test("applies external navigation and clears the old write marker", async () => {
  let updates = 0;
  const sync = createSearchRouteSync(() => {});
  sync.start(() => {
    updates += 1;
  });
  sync.push("https://example.com/search?q=toyota");
  sync.onUrlChange("https://example.com/search");
  await Bun.sleep(20);
  sync.onUrlChange("https://example.com/search?q=toyota");
  await Bun.sleep(20);
  expect(updates).toBe(2);
});

test("stops notifying the disposed router", async () => {
  let updates = 0;
  const sync = createSearchRouteSync(() => {});
  sync.start(() => {
    updates += 1;
  });
  sync.onUrlChange("https://example.com/search?q=honda");
  sync.dispose();
  await Bun.sleep(20);
  expect(updates).toBe(0);
});

test("cancels an external route replay superseded by a search write", async () => {
  let updates = 0;
  const sync = createSearchRouteSync(() => {});
  sync.start(() => {
    updates += 1;
  });
  sync.onUrlChange("https://example.com/search?q=honda");
  sync.push("https://example.com/search?q=toyota");
  await Bun.sleep(20);
  expect(updates).toBe(0);
});

test.each(["", "toyota"])(
  "commits %j immediately after browser history navigation",
  async (nextQuery) => {
    const previousWindow = Object.getOwnPropertyDescriptor(
      globalThis,
      "window",
    );
    const events = new EventTarget();
    const browser = {
      location: new URL("https://example.com/search?q=ford"),
      history: { length: 3 },
      addEventListener: events.addEventListener.bind(events),
      removeEventListener: events.removeEventListener.bind(events),
    };
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: browser,
    });
    const config = createSearchRouting("vehicles", false, false);
    const sync = createSearchRouteSync((url) => {
      browser.location = new URL(url);
    });
    const router = historyRouter({
      ...config.router,
      start: sync.start,
      dispose: sync.dispose,
      push: sync.push,
    });
    let query = "ford";
    const commit = (value: string) => {
      if (value === query) return;
      query = value;
      router.write({ vehicles: value ? { query: value } : {} });
    };
    // Next's listener is registered before InstantSearch's native popstate listener.
    events.addEventListener("popstate", () =>
      sync.onUrlChange(browser.location.href),
    );
    router.onUpdate((route) => commit(String(route.vehicles?.query ?? "")));
    try {
      browser.location = new URL("https://example.com/search?q=honda");
      events.dispatchEvent(new Event("popstate"));
      await Bun.sleep(20);
      expect(query).toBe("honda");
      browser.location = new URL("https://example.com/search?q=ford");
      events.dispatchEvent(new Event("popstate"));
      await Bun.sleep(20);
      expect(query).toBe("ford");
      commit(nextQuery);
      await Bun.sleep(450);
      expect(browser.location.searchParams.get("q") ?? "").toBe(nextQuery);
    } finally {
      router.dispose();
      if (previousWindow)
        Object.defineProperty(globalThis, "window", previousWindow);
      else Reflect.deleteProperty(globalThis, "window");
    }
  },
);
