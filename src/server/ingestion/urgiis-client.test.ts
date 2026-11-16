import { expect, spyOn, test } from "bun:test";
import { Effect } from "effect";
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
