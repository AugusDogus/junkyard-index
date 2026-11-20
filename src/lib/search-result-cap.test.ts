import { describe, expect, test } from "bun:test";
import {
  SearchResultCap,
  type SearchResultCapReason,
} from "./search-result-cap";

const firstPage = (reason: SearchResultCapReason): SearchResultCap => ({
  kind: "capped",
  limit: 24,
  reason,
});

describe("SearchResultCap.resolve", () => {
  test("caps visitors whatever the plan state says", () => {
    expect(
      SearchResultCap.resolve({
        isLoggedIn: false,
        planAccess: { kind: "resolved", tier: "full" },
      }),
    ).toEqual(firstPage("visitor"));
  });

  test("caps a signed-in free account like a visitor", () => {
    expect(
      SearchResultCap.resolve({
        isLoggedIn: true,
        planAccess: { kind: "resolved", tier: "free" },
      }),
    ).toEqual(firstPage("free_plan"));
  });

  test("lets Lite and Full browse every page", () => {
    for (const tier of ["lite", "full"] as const) {
      expect(
        SearchResultCap.resolve({
          isLoggedIn: true,
          planAccess: { kind: "resolved", tier },
        }),
      ).toEqual({ kind: "uncapped" });
    }
  });

  test("keeps an unresolved plan on the first page", () => {
    expect(
      SearchResultCap.resolve({
        isLoggedIn: true,
        planAccess: { kind: "loading" },
      }),
    ).toEqual(firstPage("plan_pending"));
    expect(
      SearchResultCap.resolve({
        isLoggedIn: true,
        planAccess: { kind: "unavailable", reason: "lookup_failed" },
      }),
    ).toEqual(firstPage("plan_unconfirmed"));
  });

  test("only a visitor or free plan cap is the plan's limit", () => {
    expect(SearchResultCap.isPlanLimit(firstPage("visitor"))).toBe(true);
    expect(SearchResultCap.isPlanLimit(firstPage("free_plan"))).toBe(true);
    expect(SearchResultCap.isPlanLimit(firstPage("plan_pending"))).toBe(false);
    expect(SearchResultCap.isPlanLimit(firstPage("plan_unconfirmed"))).toBe(
      false,
    );
    expect(SearchResultCap.isPlanLimit({ kind: "uncapped" })).toBe(false);
  });
});
