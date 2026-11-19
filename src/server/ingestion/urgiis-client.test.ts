import { expect, spyOn, test } from "bun:test";
import { Effect, Either } from "effect";
import {
  ProviderChunkClock,
  ProviderTurnDeferred,
} from "./provider-chunk-clock";
import { runWithQueuedHost } from "./provider-host-test-support";
import { readUrgiisPage } from "./urgiis-client";
import type { UrgiisTenant } from "./urgiis-tenant";

const tenant: UrgiisTenant = {
  code: "fixture",
  origin: "https://example.com",
  urgid: "PP42",
  pathStyle: "parts",
  makesPath: "/parts/makes/",
  arrivalsPath: "/recent-arrivals/",
  ownerPath: "/",
  ownerClaims: ["Fixture"],
  cookie: "urg_hv=1",
  pacingMs: 1,
  requestTimeoutMs: 40_000,
  minimumInventory: 1,
  photoCodes: ["pp42"],
  skipBlankVin: false,
  placeholderStocks: [],
  attribution: { kind: "site" },
  yard: {
    source: "urgiis",
    code: "fixture",
    name: "Fixture",
    operator: null,
    address: "1 Main St",
    city: "Test",
    state: "MN",
    postalCode: "55044",
    lat: 44,
    lng: -93,
    phone: null,
    email: null,
    websiteUrl: "https://example.com/",
  },
};

test("URG IIS sends the configured verification cookie and owned complete HTML requests", async () => {
  const fetch = spyOn(globalThis, "fetch").mockResolvedValue(
    new Response("native HTML", {
      headers: { "content-type": "text/html; charset=UTF-8" },
    }),
  );
  try {
    expect(
      await Effect.runPromise(
        readUrgiisPage(tenant.origin + tenant.makesPath, tenant),
      ),
    ).toBe("native HTML");
    expect(fetch).toHaveBeenCalledTimes(1);
    const request = fetch.mock.calls[0];
    expect(request?.[0]).toBe("https://example.com/parts/makes/");
    expect(request?.[1]?.redirect).toBe("manual");
    expect(new Headers(request?.[1]?.headers).get("cookie")).toBe("urg_hv=1");
    await expect(
      Effect.runPromise(
        readUrgiisPage("https://other.example/parts/makes/", tenant),
      ),
    ).rejects.toThrow("outside the qualified native graph");
    await expect(
      Effect.runPromise(
        readUrgiisPage(tenant.origin + "/parts/FORD/?page=2", tenant),
      ),
    ).rejects.toThrow("outside the qualified native graph");
    expect(fetch).toHaveBeenCalledTimes(1);
  } finally {
    fetch.mockRestore();
  }
});

test("URG IIS encodes model-name parentheses without changing the published graph", async () => {
  const literal = tenant.origin + "/parts/CHRYSLER/NEW_YORKER_(RWD)/";
  const encoded = tenant.origin + "/parts/CHRYSLER/NEW_YORKER_%28RWD%29/";
  const nativeResponse = () => {
    const response = new Response("native HTML", {
      headers: { "content-type": "text/html" },
    });
    Object.defineProperty(response, "url", { value: encoded });
    return response;
  };
  const fetch = spyOn(globalThis, "fetch")
    .mockRejectedValue(
      new Error("Unexpected extra request in offline IIS test"),
    )
    .mockResolvedValueOnce(nativeResponse())
    .mockResolvedValueOnce(nativeResponse());
  try {
    expect(await Effect.runPromise(readUrgiisPage(literal, tenant))).toBe(
      "native HTML",
    );
    expect(await Effect.runPromise(readUrgiisPage(encoded, tenant))).toBe(
      "native HTML",
    );
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls.map((call) => call[0])).toEqual([encoded, encoded]);
  } finally {
    fetch.mockRestore();
  }
});

test("URG IIS sends the qualified tenant's User-Agent", async () => {
  const firefox: UrgiisTenant = { ...tenant, userAgent: "firefox" };
  const nativeResponse = () =>
    new Response("native HTML", { headers: { "content-type": "text/html" } });
  const fetch = spyOn(globalThis, "fetch")
    .mockRejectedValue(
      new Error("Unexpected extra request in offline IIS test"),
    )
    .mockResolvedValueOnce(nativeResponse())
    .mockResolvedValueOnce(nativeResponse());
  try {
    for (const configured of [firefox, tenant])
      await Effect.runPromise(readUrgiisPage(tenant.origin + "/", configured));
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(
      new Headers(fetch.mock.calls[0]?.[1]?.headers).get("user-agent"),
    ).toBe(
      "Mozilla/5.0 (X11; Linux x86_64; rv:157.0) Gecko/20100101 Firefox/157.0",
    );
    expect(
      new Headers(fetch.mock.calls[1]?.[1]?.headers).get("user-agent"),
    ).toContain("Chrome/142.0.0.0");
  } finally {
    fetch.mockRestore();
  }
});

for (const status of [403, 429] as const) {
  test(`URG IIS stops immediately on HTTP${status} and retains Retry-After`, async () => {
    const fetch = spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("blocked", {
        status,
        headers: { "content-type": "text/html", "Retry-After": "3600" },
      }),
    );
    try {
      const result = await Effect.runPromise(
        readUrgiisPage(tenant.origin + tenant.makesPath, tenant).pipe(
          Effect.either,
        ),
      );
      expect(result._tag).toBe("Left");
      if (result._tag !== "Left") throw new Error("Expected blocked response");
      if (result.left instanceof ProviderTurnDeferred) throw result.left;
      expect(result.left.kind).toBe("blocked");
      if (result.left.kind !== "blocked")
        throw new Error("Expected structured host block");
      expect(result.left.status).toBe(status);
      expect(result.left.retryAfterMs).toBe(3_600_000);
      expect(result.left.message).toContain("Retry-After: 3600");
      expect(fetch).toHaveBeenCalledTimes(1);
    } finally {
      fetch.mockRestore();
    }
  });
}

test("a URG IIS read whose retry cannot get a shared host turn in this chunk ends with its failure", async () => {
  // Under 07:00 contention a failing page's retries cannot all get turns in
  // one chunk. Ending the read with its failure lets the connector defer the
  // model and carry its donors instead of deferring onto the same page.
  const site: UrgiisTenant = { ...tenant, origin: "https://eagleautopart.com" };
  const fetch = spyOn(globalThis, "fetch").mockImplementation(
    Object.assign(async () => new Response("", { status: 500 }), {
      preconnect: globalThis.fetch.preconnect,
    }),
  );
  try {
    const run = await runWithQueuedHost(
      ProviderChunkClock.deadline({
        duration: "8 minutes",
        onTimeout: () => new Error("work deadline"),
      })(readUrgiisPage(site.origin + site.makesPath, site)),
      { turnWaitMs: 150_000 },
    );
    if (Either.isRight(run.result)) throw new Error("Expected a failure");
    expect(run.result.left).not.toBeInstanceOf(ProviderTurnDeferred);
    expect(run.result.left).toMatchObject({
      tag: "UrgiisError",
      kind: "failure",
    });
    expect(run.turns).toHaveLength(2);
    expect(run.cancelled).toBe(1);
    expect(fetch).toHaveBeenCalledTimes(2);
  } finally {
    fetch.mockRestore();
  }
}, 60_000);
