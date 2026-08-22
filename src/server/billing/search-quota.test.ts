import { describe, expect, test } from "bun:test";
import {
  currentUtcDay,
  evaluateSearchQuota,
} from "~/server/billing/search-quota";

describe("evaluateSearchQuota", () => {
  test("the Nth search is allowed when N <= limit", () => {
    expect(evaluateSearchQuota(1).allowed).toBe(true);
    expect(evaluateSearchQuota(9).allowed).toBe(true);
    expect(evaluateSearchQuota(10).allowed).toBe(true);
    expect(evaluateSearchQuota(10).dailyLimit).toBe(10);
  });

  test("searches beyond the limit are blocked", () => {
    expect(evaluateSearchQuota(11).allowed).toBe(false);
    expect(evaluateSearchQuota(50).allowed).toBe(false);
  });

  test("custom limits are honored", () => {
    expect(evaluateSearchQuota(3, 3).allowed).toBe(true);
    expect(evaluateSearchQuota(4, 3).allowed).toBe(false);
  });
});

describe("currentUtcDay", () => {
  test("buckets by UTC calendar day", () => {
    // 2026-08-21T23:59:59Z is still "2026-08-21" in UTC
    expect(currentUtcDay(new Date("2026-08-21T23:59:59.999Z"))).toBe(
      "2026-08-21",
    );
    // One millisecond later it rolls to the next UTC day
    expect(currentUtcDay(new Date("2026-08-22T00:00:00.000Z"))).toBe(
      "2026-08-22",
    );
    // A local-timezone evening is bucketed by its UTC date
    expect(currentUtcDay(new Date("2026-01-01T04:30:00.000Z"))).toBe(
      "2026-01-01",
    );
  });
});
