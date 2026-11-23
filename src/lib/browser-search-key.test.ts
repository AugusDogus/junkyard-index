import { describe, expect, mock, test } from "bun:test";
import { BrowserSearchKey, SearchKeyUnavailable } from "./browser-search-key";
import type { SearchKeyGrant } from "./search-key-grant";

const NOW_MS = Date.UTC(2026, 10, 20, 12);
const MINUTE = 60_000;

function grant(
  apiKey: string,
  expiresInSeconds: number,
  tier: SearchKeyGrant["tier"] = "free",
  hiddenSources: string[] = [],
): SearchKeyGrant {
  return { apiKey, expiresInSeconds, tier, hiddenSources };
}

/** A browser clock the test moves by hand. */
function clock(startMs = NOW_MS) {
  let nowMs = startMs;
  return {
    now: () => nowMs,
    advance(ms: number) {
      nowMs += ms;
    },
  };
}

function serving(...grants: SearchKeyGrant[]) {
  return mock(async () => {
    const next = grants.shift();
    return next ? Response.json(next) : new Response(null, { status: 500 });
  });
}

describe("BrowserSearchKey", () => {
  test("names the hidden sources of the key it holds, so a renewed key brings a new list", async () => {
    const time = clock();
    const fetcher = serving(grant("renewed", 900, "free", ["meeks", "pratt"]));
    const key = BrowserSearchKey.create(fetcher, time.now);
    const notified = mock(() => undefined);
    key.subscribe(notified);
    expect(key.hiddenSources()).toBeNull();
    key.prime(grant("primed", 900, "free", ["meeks"]));
    const primed = key.hiddenSources();
    expect(primed?.list).toEqual(["meeks"]);
    // The same object while the key is held, as useSyncExternalStore needs.
    expect(key.hiddenSources()).toBe(primed);
    time.advance(11 * MINUTE);
    expect(await key.current()).toBe("renewed");
    expect(key.hiddenSources()?.list).toEqual(["pratt", "meeks"]);
    expect(notified).toHaveBeenCalledTimes(1);
  });

  test("uses the primed key without asking the server", async () => {
    const fetcher = serving();
    const key = BrowserSearchKey.create(fetcher, clock().now);
    key.prime(grant("primed", 3600));
    expect(await key.current()).toBe("primed");
    expect(fetcher).not.toHaveBeenCalled();
  });

  test("fetches one replacement for concurrent searches when the key nears expiry", async () => {
    const fetcher = serving(grant("fresh", 3600));
    const key = BrowserSearchKey.create(fetcher, clock().now);
    key.prime(grant("old", 60));
    expect(await Promise.all([key.current(), key.current()])).toEqual([
      "fresh",
      "fresh",
    ]);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  test("renews a rendered key after the plan changes, and a re-render cannot restore it", async () => {
    const fetcher = serving(grant("paid", 3600, "lite"));
    const key = BrowserSearchKey.create(fetcher, clock().now);
    const rendered = grant("free", 3600);
    key.prime(rendered);
    key.renewFor("free");
    expect(key.tier()).toBe("free");
    key.renewFor("lite");
    expect(key.tier()).toBeNull();
    key.prime(rendered);
    expect(await key.current()).toBe("paid");
    key.renewFor("full");
    expect(key.tier()).toBe("lite");
  });

  test("keeps a key the server fetched for the plan the page still shows", async () => {
    const fetcher = serving(grant("still-free", 3600));
    const key = BrowserSearchKey.create(fetcher, clock().now);
    key.prime(grant("free", 3600));
    key.renewFor("lite");
    expect(await key.current()).toBe("still-free");
    key.renewFor("lite");
    expect(await key.current()).toBe("still-free");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  test("a later render's stale free key does not override a paid plan", async () => {
    // Navigating back to /search within the server's tier cache renders a
    // newer free key over the paid one fetched after checkout.
    const fetcher = serving(
      grant("paid", 3600, "lite"),
      grant("paid-again", 3600, "lite"),
    );
    const key = BrowserSearchKey.create(fetcher, clock().now);
    key.prime(grant("free", 3600));
    key.renewFor("lite");
    expect(await key.current()).toBe("paid");
    key.prime(grant("newer-free", 7200));
    key.renewFor("lite");
    expect(key.tier()).toBeNull();
    expect(await key.current()).toBe("paid-again");
  });

  test("a key fetched before a checkout is replaced once the plan turns paid", async () => {
    const fetcher = serving(
      grant("free-refresh", 3600),
      grant("paid", 3600, "full"),
    );
    const key = BrowserSearchKey.create(fetcher, clock().now);
    key.prime(grant("expiring", 60));
    key.renewFor("free");
    expect(await key.current()).toBe("free-refresh");
    key.renewFor("full");
    expect(key.tier()).toBeNull();
    expect(await key.current()).toBe("paid");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  test("reports a refused key as a tagged error and retries on the next search", async () => {
    const key = BrowserSearchKey.create(
      serving(grant("later", 3600)).mockImplementationOnce(
        async () => new Response(null, { status: 503 }),
      ),
      clock().now,
    );
    const failure = await key.current().catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(SearchKeyUnavailable);
    expect(failure).toMatchObject({ status: 503 });
    expect(await key.current()).toBe("later");
  });

  test("reports its key's tier and tells readers when a fetched key lands", async () => {
    const key = BrowserSearchKey.create(
      serving(grant("paid", 3600, "lite")),
      clock().now,
    );
    const listener = mock(() => undefined);
    key.subscribe(listener);
    key.prime(grant("free", 3600));
    expect(key.tier()).toBe("free");
    key.renewFor("lite");
    expect(key.tier()).toBeNull();
    expect(listener).not.toHaveBeenCalled();
    await key.current();
    expect(key.tier()).toBe("lite");
    expect(listener).toHaveBeenCalledTimes(1);
  });

  // validUntil is on the server's clock; renewal is on the browser's,
  // measured from receipt, so a skewed device clock changes nothing.
  for (const [label, skewMs] of [
    ["an hour ahead", 60 * MINUTE],
    ["an hour behind", -60 * MINUTE],
  ] as const) {
    test(`renews on schedule with a browser clock ${label} of the server`, async () => {
      const browser = clock(NOW_MS + skewMs);
      const fetcher = serving(grant("renewed", 3600));
      const key = BrowserSearchKey.create(fetcher, browser.now);
      key.prime(grant("rendered", 3600));
      expect(await key.current()).toBe("rendered");
      browser.advance(54 * MINUTE);
      expect(await key.current()).toBe("rendered");
      expect(fetcher).not.toHaveBeenCalled();
      browser.advance(2 * MINUTE);
      expect(await key.current()).toBe("renewed");
      expect(await key.current()).toBe("renewed");
      expect(fetcher).toHaveBeenCalledTimes(1);
    });
  }

  test("replaces a key Algolia refuses, at most once a minute", async () => {
    const browser = clock();
    const fetcher = serving(grant("second", 3600), grant("third", 3600));
    const key = BrowserSearchKey.create(fetcher, browser.now);
    key.prime(grant("refused", 3600));
    expect(key.reject("refused")).toBe(true);
    expect(await key.current()).toBe("second");
    // A key that was already replaced is worth one retry with the new one.
    expect(key.reject("refused")).toBe(true);
    // Refused again within the minute: keep it rather than fetch per search.
    expect(key.reject("second")).toBe(false);
    expect(await key.current()).toBe("second");
    browser.advance(MINUTE);
    expect(key.reject("second")).toBe(true);
    expect(await key.current()).toBe("third");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  test("a renewal fetches the new key without waiting for a search", async () => {
    // A capped page may never search again, and its cap follows the key.
    const fetcher = serving(grant("paid", 3600, "lite"));
    const key = BrowserSearchKey.create(fetcher, clock().now);
    const listener = mock(() => undefined);
    key.subscribe(listener);
    key.prime(grant("rendered-free", 3600));
    key.renewFor("lite");
    expect(key.tier()).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(key.tier()).toBe("lite");
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
