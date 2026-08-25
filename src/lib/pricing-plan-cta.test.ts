import { describe, expect, test } from "bun:test";
import {
  resolvePricingPlanCta,
  resolvePricingViewerState,
} from "./pricing-plan-cta";

describe("pricing plan CTA", () => {
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
      href: "/auth/sign-up?returnTo=%2Fpricing",
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
