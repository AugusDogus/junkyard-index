import { describe, expect, test } from "bun:test";
import type { PlanTier } from "~/lib/plans";
import type { CustomerStateLike } from "~/server/billing/plan-tier";
import {
  createPlanTierService,
  type PlanTierService,
} from "~/server/billing/user-plan";
import { createTierCache } from "~/server/billing/tier-cache";

function createFakePolar(initial: CustomerStateLike) {
  let state = initial;
  let failNext = false;
  let calls = 0;
  return {
    calls: () => calls,
    failNextCall() {
      failNext = true;
    },
    fetchCustomerState: async (): Promise<CustomerStateLike> => {
      calls += 1;
      if (failNext) {
        failNext = false;
        throw new Error("polar down");
      }
      return state;
    },
  };
}

const LITE_STATE: CustomerStateLike = {
  activeSubscriptions: [{ productId: "lite-monthly-id" }],
};

function createTestService(
  polar: ReturnType<typeof createFakePolar>,
): PlanTierService & { polar: typeof polar } {
  const service = createPlanTierService({
    fetchCustomerState: polar.fetchCustomerState,
    resolveTier: (state) =>
      state.activeSubscriptions?.some((s) => s.productId === "lite-monthly-id")
        ? "lite"
        : ("free" as PlanTier),
  });
  return { ...service, polar };
}

describe("getPlanTier caching", () => {
  test("caches resolved tiers and serves repeats without hitting Polar", async () => {
    const test = createTestService(createFakePolar(LITE_STATE));

    const first = await test.getPlanTier("cache-user-1");
    const second = await test.getPlanTier("cache-user-1");

    expect(first).toBe("lite");
    expect(second).toBe("lite");
    expect(test.polar.calls()).toBe(1);
  });

  test("invalidateCache forces a fresh Polar read", async () => {
    const test = createTestService(createFakePolar(LITE_STATE));
    await test.getPlanTier("cache-user-2");

    test.invalidateCache("cache-user-2");
    await test.getPlanTier("cache-user-2");

    expect(test.polar.calls()).toBe(2);
  });

  test("Polar failures resolve to free and are NOT cached (fail-closed, retried)", async () => {
    const test = createTestService(createFakePolar(LITE_STATE));
    test.polar.failNextCall();

    const failed = await test.getPlanTier("cache-user-3");
    expect(failed).toBe("free");

    const recovered = await test.getPlanTier("cache-user-3");
    expect(recovered).toBe("lite");
    expect(test.polar.calls()).toBe(2);
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
