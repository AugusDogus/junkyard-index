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
  ownerPath: "/",
  ownerClaims: ["Fixture"],
  cookie: "urg_hv=1",
  pacingMs: 1,
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
