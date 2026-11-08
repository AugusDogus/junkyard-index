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
import { EnsureAppProviders } from "~/components/AppProviders";

const BILLING_INTERVALS: readonly { value: BillingInterval; label: string }[] =
  [
    { value: "monthly", label: "Monthly" },
    { value: "annual", label: "Annual" },
  ];

type PricingPlansSectionProps = {
  initialIsRegistered: boolean;
  sourcePage?: "home" | "pricing";
};

/** The plans and their actions; brings its own app providers where needed. */
export function PricingPlansSection(props: PricingPlansSectionProps) {
  return (
    <EnsureAppProviders>
      <PricingPlans {...props} />
    </EnsureAppProviders>
  );
}

function PricingPlans({
  initialIsRegistered,
  sourcePage = "pricing",
}: PricingPlansSectionProps) {
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
        className="border-ink flex w-fit border-2"
        aria-label="Billing interval"
        role="group"
      >
        {BILLING_INTERVALS.map((option) => (
          <button
            key={option.value}
            type="button"
            className={cn(
              "board-step focus-visible:outline-focus not-first:border-ink h-11 px-5 text-sm font-extrabold outline-none not-first:border-l-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid",
              interval === option.value
                ? "bg-ink text-paper"
                : "text-ink hover:bg-paper-2",
            )}
            aria-pressed={interval === option.value}
            onClick={() => setInterval(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>

      <div className="mt-8 grid gap-4 md:grid-cols-3 lg:gap-8">
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
        <p className="text-ink-2 mt-6 text-sm">
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
  // On the ink plate the cobalt button flips to paper on hover, not to ink.
  const className = cn(
    "h-12 w-full",
    featured &&
      "hover:border-board-ink hover:bg-board-ink hover:text-board focus-visible:outline-figure",
  );
  switch (cta.kind) {
    case "disabled":
      return (
        <Button variant={variant} className={className} disabled>
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
          className={className}
        />
      );
    case "checkout":
      return (
        <Button
          variant={variant}
          className={className}
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
          className={className}
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
