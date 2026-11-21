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
      validUntil: NOW_MS / 1000 + 3600,
      tier: "lite",
    });
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
