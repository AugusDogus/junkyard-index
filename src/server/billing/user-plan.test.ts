import { describe, expect, mock, test } from "bun:test";
import type { CustomerStateLike } from "~/server/billing/plan-tier";

// Mock the Polar SDK client before importing user-plan so cache behavior is
// observable without network access.
let nextResult:
  | { ok: true; state: CustomerStateLike }
  | { ok: false; error: unknown } = {
  ok: true,
  state: { activeSubscriptions: [] },
};
let polarCalls = 0;

mock.module("~/server/billing/polar-client", () => ({
  polarClient: {
    customers: {
      getStateExternal: async () => {
        polarCalls += 1;
        if (!nextResult.ok) {
          throw nextResult.error;
        }
        return nextResult.state;
      },
    },
  },
}));

const { getPlanTier, invalidatePlanTierCache } = await import(
  "~/server/billing/user-plan"
);
const { createTierCache } = await import("~/server/billing/tier-cache");

// From tests/setup-env.ts: POLAR_LITE_PRODUCT_ID = ...0002, FULL = ...0004
const LITE_STATE: CustomerStateLike = {
  activeSubscriptions: [{ productId: "00000000-0000-4000-8000-000000000002" }],
};

describe("getPlanTier caching", () => {
  test("caches resolved tiers and serves repeats without hitting Polar", async () => {
    polarCalls = 0;
    nextResult = { ok: true, state: LITE_STATE };

    const first = await getPlanTier("cache-user-1");
    const second = await getPlanTier("cache-user-1");

    expect(first).toBe("lite");
    expect(second).toBe("lite");
    expect(polarCalls).toBe(1);
  });

  test("invalidatePlanTierCache forces a fresh Polar read", async () => {
    polarCalls = 0;
    nextResult = { ok: true, state: LITE_STATE };
    await getPlanTier("cache-user-2");

    invalidatePlanTierCache("cache-user-2");
    await getPlanTier("cache-user-2");

    expect(polarCalls).toBe(2);
  });

  test("Polar failures resolve to free and are NOT cached (fail-closed, retried)", async () => {
    polarCalls = 0;
    nextResult = { ok: false, error: new Error("polar down") };

    const failed = await getPlanTier("cache-user-3");
    expect(failed).toBe("free");

    // Recovery after the blip must not be blocked by a cached failure
    nextResult = { ok: true, state: LITE_STATE };
    const recovered = await getPlanTier("cache-user-3");

    expect(recovered).toBe("lite");
    expect(polarCalls).toBe(2);
  });
});

describe("createTierCache", () => {
  test("entries expire after ttl", () => {
    let nowMs = 1_000_000;
    const cache = createTierCache(60_000, () => nowMs);

    cache.set("u1", "full");
    expect(cache.get("u1")).toBe("full");

    nowMs += 59_999;
    expect(cache.get("u1")).toBe("full");

    nowMs += 1; // past expiry
    expect(cache.get("u1")).toBeNull();
  });

  test("invalidate drops entries immediately", () => {
    let nowMs = 1_000_000;
    const cache = createTierCache(60_000, () => nowMs);

    cache.set("u1", "lite");
    cache.invalidate("u1");

    expect(cache.get("u1")).toBeNull();
  });
});
