import { describe, expect, mock, test } from "bun:test";
import type { PlanTier } from "~/lib/plans";
import { SearchKeyGranter } from "./search-key-granter";

const NOW_MS = Date.UTC(2026, 10, 20, 12);
const headers = new Headers({ "x-real-ip": "203.0.113.7" });

function restrictionsOf(apiKey: string) {
  return new URLSearchParams(
    Buffer.from(apiKey, "base64").toString("utf8").slice(64),
  );
}

function granter(input: {
  parentApiKey?: string;
  tier?: PlanTier;
  clientIp?: string;
}) {
  const planTier = mock(async () => input.tier ?? "free");
  const clientIp = mock(() => input.clientIp ?? "203.0.113.7");
  const warn = mock(() => undefined);
  const grant = SearchKeyGranter.create({
    parentApiKey: input.parentApiKey,
    serverApiKey: "server-search-key",
    planTier,
    clientIp,
    warn,
  });
  return { grant, planTier, clientIp, warn };
}

describe("SearchKeyGranter", () => {
  test("visitors get a free key without a plan lookup", async () => {
    const { grant, planTier } = granter({ parentApiKey: "parent" });
    const key = await grant({ userId: null, headers, nowMs: NOW_MS });
    expect(key.tier).toBe("free");
    expect(planTier).not.toHaveBeenCalled();
    expect(restrictionsOf(key.apiKey).get("page")).toBe("0");
  });

  test("signed-in accounts get the tier the server resolves", async () => {
    for (const tier of ["free", "lite", "full"] as const) {
      const { grant, planTier } = granter({ parentApiKey: "parent", tier });
      const key = await grant({ userId: "user-1", headers, nowMs: NOW_MS });
      expect(planTier).toHaveBeenCalledWith("user-1");
      expect(key.tier).toBe(tier);
      expect(restrictionsOf(key.apiKey).has("page")).toBe(tier === "free");
    }
  });

  test("rate limits accounts per account and visitors per IP", async () => {
    const tokenFor = async (userId: string | null, clientIp: string) => {
      const { grant } = granter({ parentApiKey: "parent", clientIp });
      const key = await grant({ userId, headers, nowMs: NOW_MS });
      return restrictionsOf(key.apiKey).get("userToken");
    };
    expect(await tokenFor("user-1", "198.51.100.1")).toBe(
      await tokenFor("user-1", "198.51.100.2"),
    );
    expect(await tokenFor(null, "198.51.100.1")).not.toBe(
      await tokenFor(null, "198.51.100.2"),
    );
    expect(await tokenFor("user-1", "198.51.100.1")).not.toBe(
      await tokenFor(null, "198.51.100.1"),
    );
  });

  test("without a parent key, sends the server key unrestricted and warns once", async () => {
    const { grant, warn } = granter({ tier: "lite" });
    const first = await grant({ userId: "user-1", headers, nowMs: NOW_MS });
    await grant({ userId: null, headers, nowMs: NOW_MS });
    expect(first).toEqual({
      apiKey: "server-search-key",
      expiresInSeconds: 3600,
      tier: "lite",
    });
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe("SearchKeyGranter.pair", () => {
  function grants(input: { direct: () => Promise<PlanTier> }) {
    const cachedTier = mock(async (): Promise<PlanTier> => "free");
    const directTier = mock(input.direct);
    const pair = SearchKeyGranter.pair({
      parentApiKey: "parent",
      serverApiKey: "server-search-key",
      cachedTier,
      directTier,
      clientIp: () => "203.0.113.7",
      warn: () => undefined,
    });
    return { ...pair, cachedTier, directTier };
  }

  test("renewals ask the billing provider directly, never the tier cache", async () => {
    // The cache still says free right after a checkout; Polar says lite.
    const { forRender, forRenewal, cachedTier, directTier } = grants({
      direct: async () => "lite",
    });
    const renewed = await forRenewal({
      userId: "user-1",
      headers,
      nowMs: NOW_MS,
    });
    expect(renewed.tier).toBe("lite");
    expect(directTier).toHaveBeenCalledWith("user-1");
    expect(cachedTier).not.toHaveBeenCalled();
    const rendered = await forRender({
      userId: "user-1",
      headers,
      nowMs: NOW_MS,
    });
    expect(rendered.tier).toBe("free");
    expect(cachedTier).toHaveBeenCalledTimes(1);
    expect(directTier).toHaveBeenCalledTimes(1);
  });

  test("a billing outage renews with a free key and a 200, not an error", async () => {
    const { forRenewal } = grants({
      direct: async () => {
        throw new Error("Polar is down");
      },
    });
    const response = await SearchKeyGranter.respond(forRenewal, {
      userId: "user-1",
      headers,
      nowMs: NOW_MS,
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    const body: unknown = await response.json();
    expect(body).toMatchObject({ tier: "free", expiresInSeconds: 3600 });
  });

  test("anonymous renewals never call the billing provider", async () => {
    const { forRenewal, cachedTier, directTier } = grants({
      direct: async () => "full",
    });
    const key = await forRenewal({ userId: null, headers, nowMs: NOW_MS });
    expect(key.tier).toBe("free");
    expect(directTier).not.toHaveBeenCalled();
    expect(cachedTier).not.toHaveBeenCalled();
  });
});
