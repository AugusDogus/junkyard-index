import { describe, expect, test } from "bun:test";
import type { CustomerStateLike } from "~/server/billing/plan-tier";
import {
  createPlanTierService,
  type PlanTierService,
} from "~/server/billing/plan-tier-service";
import { createTierCache } from "~/server/billing/tier-cache";

function createFakePolar(initial: CustomerStateLike) {
  let state = initial;
  let failNext = false;
  let calls = 0;
  return {
    calls: () => calls,
    setState(next: CustomerStateLike) {
      state = next;
    },
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
        : "free",
    onError: () => {},
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

  test("Polar failures resolve to free and are NOT cached (fail-closed, retried)", async () => {
    const test = createTestService(createFakePolar(LITE_STATE));
    test.polar.failNextCall();

    const failed = await test.getPlanTier("cache-user-3");
    expect(failed).toBe("free");

    const recovered = await test.getPlanTier("cache-user-3");
    expect(recovered).toBe("lite");
    expect(test.polar.calls()).toBe(2);
  });

  test("authoritative reads bypass and replace a cached tier", async () => {
    const polar = createFakePolar(LITE_STATE);
    const test = createTestService(polar);
    expect(await test.getPlanTier("cache-user-4")).toBe("lite");

    polar.setState({ activeSubscriptions: [] });
    expect(await test.getAuthoritativePlanTier("cache-user-4")).toBe("free");
    expect(await test.getPlanTier("cache-user-4")).toBe("free");
    expect(polar.calls()).toBe(2);
  });

  test("authoritative reads propagate provider failures instead of authorizing as free", async () => {
    const test = createTestService(createFakePolar(LITE_STATE));
    test.polar.failNextCall();

    await expect(test.getAuthoritativePlanTier("cache-user-5")).rejects.toThrow(
      "polar down",
    );
  });

  test("checkout refresh replaces a cached free tier once Polar reports paid", async () => {
    const polar = createFakePolar({ activeSubscriptions: [] });
    const test = createTestService(polar);
    expect(await test.getPlanTier("cache-user-6")).toBe("free");

    polar.setState(LITE_STATE);
    expect(await test.getAuthoritativePlanTier("cache-user-6")).toBe("lite");
    expect(await test.getPlanTier("cache-user-6")).toBe("lite");
    expect(polar.calls()).toBe(2);
  });

  test("reuses a tier resolved from an existing customer snapshot", async () => {
    const test = createTestService(createFakePolar(LITE_STATE));

    test.rememberPlanTierFromSnapshot("cache-user-7", "full");

    expect(await test.getPlanTier("cache-user-7")).toBe("full");
    expect(test.polar.calls()).toBe(0);
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
});
