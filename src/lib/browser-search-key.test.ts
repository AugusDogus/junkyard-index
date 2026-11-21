import { describe, expect, mock, test } from "bun:test";
import { BrowserSearchKey, SearchKeyUnavailable } from "./browser-search-key";
import type { SearchKeyGrant } from "./search-key-grant";

const NOW_MS = Date.UTC(2026, 10, 20, 12);
const NOW_S = NOW_MS / 1000;

function grant(
  apiKey: string,
  validUntil: number,
  tier: SearchKeyGrant["tier"] = "free",
): SearchKeyGrant {
  return { apiKey, validUntil, tier };
}

function serving(...grants: SearchKeyGrant[]) {
  return mock(async () => {
    const next = grants.shift();
    return next ? Response.json(next) : new Response(null, { status: 500 });
  });
}

describe("BrowserSearchKey", () => {
  test("uses the primed key without asking the server", async () => {
    const fetcher = serving();
    const key = BrowserSearchKey.create(fetcher);
    key.prime(grant("primed", NOW_S + 3600));
    expect(await key.current(NOW_MS)).toBe("primed");
    expect(fetcher).not.toHaveBeenCalled();
  });

  test("fetches one replacement for concurrent searches when the key nears expiry", async () => {
    const fetcher = serving(grant("fresh", NOW_S + 3600));
    const key = BrowserSearchKey.create(fetcher);
    key.prime(grant("old", NOW_S + 60));
    expect(
      await Promise.all([key.current(NOW_MS), key.current(NOW_MS)]),
    ).toEqual(["fresh", "fresh"]);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  test("renews a rendered key after the plan changes, and a re-render cannot restore it", async () => {
    const fetcher = serving(grant("paid", NOW_S + 3600, "lite"));
    const key = BrowserSearchKey.create(fetcher);
    const rendered = grant("free", NOW_S + 3600);
    key.prime(rendered);
    key.renewFor("free");
    expect(key.tier()).toBe("free");
    key.renewFor("lite");
    expect(key.tier()).toBeNull();
    key.prime(rendered);
    expect(await key.current(NOW_MS)).toBe("paid");
    key.renewFor("full");
    expect(key.tier()).toBe("lite");
  });

  test("keeps a key the server fetched for the plan the page still shows", async () => {
    const fetcher = serving(grant("still-free", NOW_S + 3600));
    const key = BrowserSearchKey.create(fetcher);
    key.prime(grant("free", NOW_S + 3600));
    key.renewFor("lite");
    expect(await key.current(NOW_MS)).toBe("still-free");
    key.renewFor("lite");
    expect(await key.current(NOW_MS)).toBe("still-free");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  test("a later render's stale free key does not override a paid plan", async () => {
    // Navigating back to /search within the server's tier cache renders a
    // newer free key over the paid one fetched after checkout.
    const fetcher = serving(
      grant("paid", NOW_S + 3600, "lite"),
      grant("paid-again", NOW_S + 3600, "lite"),
    );
    const key = BrowserSearchKey.create(fetcher);
    key.prime(grant("free", NOW_S + 3600));
    key.renewFor("lite");
    expect(await key.current(NOW_MS)).toBe("paid");
    key.prime(grant("newer-free", NOW_S + 7200));
    key.renewFor("lite");
    expect(key.tier()).toBeNull();
    expect(await key.current(NOW_MS)).toBe("paid-again");
  });

  test("a key fetched before a checkout is replaced once the plan turns paid", async () => {
    const fetcher = serving(
      grant("free-refresh", NOW_S + 3600),
      grant("paid", NOW_S + 3600, "full"),
    );
    const key = BrowserSearchKey.create(fetcher);
    key.prime(grant("expiring", NOW_S + 60));
    key.renewFor("free");
    expect(await key.current(NOW_MS)).toBe("free-refresh");
    key.renewFor("full");
    expect(key.tier()).toBeNull();
    expect(await key.current(NOW_MS)).toBe("paid");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  test("reports a refused key as a tagged error and retries on the next search", async () => {
    const key = BrowserSearchKey.create(
      serving(grant("later", NOW_S + 3600)).mockImplementationOnce(
        async () => new Response(null, { status: 503 }),
      ),
    );
    const failure = await key.current(NOW_MS).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(SearchKeyUnavailable);
    expect(failure).toMatchObject({ status: 503 });
    expect(await key.current(NOW_MS)).toBe("later");
  });

  test("reports its key's tier and tells readers when a fetched key lands", async () => {
    const key = BrowserSearchKey.create(
      serving(grant("paid", NOW_S + 3600, "lite")),
    );
    const listener = mock(() => undefined);
    key.subscribe(listener);
    key.prime(grant("free", NOW_S + 3600));
    expect(key.tier()).toBe("free");
    key.renewFor("lite");
    expect(key.tier()).toBeNull();
    expect(listener).not.toHaveBeenCalled();
    await key.current(NOW_MS);
    expect(key.tier()).toBe("lite");
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
