import { describe, expect, test } from "bun:test";
import {
  resolvePricingPlanCta,
  resolvePricingViewerState,
} from "./pricing-plan-cta";

describe("pricing plan CTA", () => {
  for (const tier of ["lite", "full"] as const) {
    for (const interval of ["monthly", "annual"] as const) {
      test(`keeps guest selection ${tier}/${interval} through sign-up`, () => {
        const cta = resolvePricingPlanCta({
          viewer: { kind: "guest" },
          tier,
          interval,
          account: { kind: "none" },
        });
        expect(cta.kind).toBe("signup");
        if (cta.kind !== "signup") return;
        const signup = new URL(cta.href, "https://app.example");
        expect(signup.searchParams.get("returnTo")).toBe(
          `/subscribe?tier=${tier}&interval=${interval}`,
        );
      });
    }
  }
  test("uses the signed-out server state while authentication is pending", () => {
    const viewer = resolvePricingViewerState({
      initialIsRegistered: false,
      isPending: true,
      isRegistered: false,
    });
    expect(
      resolvePricingPlanCta({
        viewer,
        tier: "full",
        interval: "monthly",
        account: { kind: "loading" },
      }),
    ).toEqual({
      kind: "signup",
      href: "/auth/sign-up?returnTo=%2Fsubscribe%3Ftier%3Dfull%26interval%3Dmonthly",
      label: "Get Full",
    });
  });

  test("uses the signed-in server state while authentication is pending", () => {
    expect(
      resolvePricingViewerState({
        initialIsRegistered: true,
        isPending: true,
        isRegistered: false,
      }),
    ).toEqual({ kind: "registered" });
  });

  test("shows a registered free account as the current plan", () => {
    expect(
      resolvePricingPlanCta({
        viewer: { kind: "registered" },
        tier: "free",
        interval: "monthly",
        account: { kind: "none" },
      }),
    ).toEqual({ kind: "disabled", label: "Current plan" });
  });

  test("resolves active Lite and Full accounts without sign-up links", () => {
    expect(
      resolvePricingPlanCta({
        viewer: { kind: "registered" },
        tier: "free",
        interval: "monthly",
        account: { kind: "active", tier: "lite" },
      }),
    ).toEqual({ kind: "disabled", label: "Included with Lite" });
    expect(
      resolvePricingPlanCta({
        viewer: { kind: "registered" },
        tier: "lite",
        interval: "annual",
        account: { kind: "active", tier: "full" },
      }),
    ).toEqual({
      kind: "portal",
      account: { kind: "active", tier: "full" },
      selection: { tier: "lite", interval: "annual" },
    });
  });
});
