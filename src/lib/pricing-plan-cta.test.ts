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
  test("starts a page known to be signed out as a guest while authentication is pending", () => {
    const viewer = resolvePricingViewerState({
      initialViewer: "guest",
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

  test("offers no guest sign-up while an unknown visitor's session loads", () => {
    const viewer = resolvePricingViewerState({
      initialViewer: "unknown",
      isPending: true,
      isRegistered: false,
    });
    expect(viewer).toEqual({ kind: "pending" });
    for (const tier of ["free", "lite", "full"] as const) {
      expect(
        resolvePricingPlanCta({
          viewer,
          tier,
          interval: "monthly",
          account: { kind: "loading" },
        }),
      ).toEqual({ kind: "disabled", label: "Checking account..." });
    }
  });

  test("follows the session once it loads", () => {
    for (const initialViewer of ["guest", "unknown"] as const) {
      expect(
        resolvePricingViewerState({
          initialViewer,
          isPending: false,
          isRegistered: true,
        }),
      ).toEqual({ kind: "registered" });
      expect(
        resolvePricingViewerState({
          initialViewer,
          isPending: false,
          isRegistered: false,
        }),
      ).toEqual({ kind: "guest" });
    }
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
