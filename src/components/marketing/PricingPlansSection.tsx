"use client";

import { useState } from "react";
import { PricingPlanCard } from "~/components/marketing/PricingPlanCard";
import { TrackedPricingButton } from "~/components/marketing/TrackedPricingButton";
import { Button } from "~/components/ui/button";
import { useSubscriptionDestination } from "~/hooks/use-subscription-destination";
import { useSession } from "~/lib/auth-client";
import { PLAN_TIERS, PLANS, type BillingInterval } from "~/lib/plans";
import {
  resolvePricingPlanCta,
  resolvePricingViewerState,
  type PricingPlanCta,
} from "~/lib/pricing-plan-cta";
import type { SubscriptionAction } from "~/lib/subscription-action";
import { cn } from "~/lib/utils";

export function PricingPlansSection({
  initialIsRegistered,
  sourcePage = "pricing",
}: {
  initialIsRegistered: boolean;
  sourcePage?: "home" | "pricing";
}) {
  const [interval, setInterval] = useState<BillingInterval>("annual");
  const { data: session, isPending } = useSession();
  const isLoggedIn = Boolean(session?.user);
  const viewer = resolvePricingViewerState({
    initialIsRegistered,
    isPending,
    isRegistered: isLoggedIn,
  });
  const { state: subscriptionState, openAction } = useSubscriptionDestination({
    source: "pricing_flow",
    enabled: viewer.kind === "registered",
  });

  return (
    <div>
      <div
        className="bg-muted/50 mx-auto flex w-fit gap-1 rounded-lg border p-1"
        aria-label="Billing interval"
        role="group"
      >
        <button
          type="button"
          className={cn(
            "focus-visible:ring-ring/50 h-9 rounded-md border px-4 text-sm font-medium transition-colors outline-none focus-visible:ring-2",
            interval === "monthly"
              ? "bg-background border-border text-foreground shadow-xs"
              : "text-muted-foreground hover:text-foreground border-transparent",
          )}
          aria-pressed={interval === "monthly"}
          onClick={() => setInterval("monthly")}
        >
          Monthly
        </button>
        <button
          type="button"
          className={cn(
            "focus-visible:ring-ring/50 h-9 rounded-md border px-4 text-sm font-medium transition-colors outline-none focus-visible:ring-2",
            interval === "annual"
              ? "bg-background border-border text-foreground shadow-xs"
              : "text-muted-foreground hover:text-foreground border-transparent",
          )}
          aria-pressed={interval === "annual"}
          onClick={() => setInterval("annual")}
        >
          Annual
        </button>
      </div>

      <div className="mt-8 grid gap-4 lg:grid-cols-3 lg:gap-6">
        {PLAN_TIERS.map((tier) => {
          const featured = tier === "lite";
          const cta = resolvePricingPlanCta({
            viewer,
            tier,
            interval,
            account: subscriptionState,
          });
          return (
            <PricingPlanCard
              key={tier}
              tier={tier}
              interval={interval}
              featured={featured}
              heading={sourcePage === "home" ? "h3" : "h2"}
              cta={
                <PricingPlanCtaButton
                  cta={cta}
                  featured={featured}
                  sourcePage={sourcePage}
                  onAction={(action) => void openAction(action)}
                />
              }
            />
          );
        })}
      </div>

      {interval === "annual" && (
        <p className="text-muted-foreground mt-4 text-center text-sm">
          Annual plans are billed once per year. Manage or cancel anytime from
          your subscription portal.
        </p>
      )}
    </div>
  );
}

function PricingPlanCtaButton({
  cta,
  featured,
  sourcePage,
  onAction,
}: {
  cta: PricingPlanCta;
  featured: boolean;
  sourcePage: "home" | "pricing";
  onAction(action: SubscriptionAction): void;
}) {
  const variant = featured ? "default" : "outline";
  switch (cta.kind) {
    case "disabled":
      return (
        <Button variant={variant} className="h-10 w-full rounded-lg" disabled>
          {cta.label}
        </Button>
      );
    case "signup":
      return (
        <TrackedPricingButton
          href={cta.href}
          label={cta.label}
          sourcePage={sourcePage}
          ctaLocation="pricing_plan"
          variant={variant}
          className="h-10 w-full rounded-lg"
        />
      );
    case "checkout":
      return (
        <Button
          variant={variant}
          className="h-10 w-full rounded-lg"
          onClick={() => onAction(cta)}
        >
          Get {PLANS[cta.selection.tier].name}
        </Button>
      );
    case "portal":
      const targetTier = cta.selection.tier;
      return (
        <Button
          variant={variant}
          className="h-10 w-full rounded-lg"
          onClick={() => onAction(cta)}
        >
          {cta.account.kind === "needs_attention"
            ? "Manage Subscription"
            : cta.account.tier === targetTier
              ? `Manage ${PLANS[targetTier].name}`
              : `Change to ${PLANS[targetTier].name}`}
        </Button>
      );
  }
}
