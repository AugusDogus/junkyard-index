"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "~/components/ui/button";
import { useSubscriptionDestination } from "~/hooks/use-subscription-destination";
import { useSession } from "~/lib/auth-client";
import {
  FREE_DAILY_SEARCH_LIMIT,
  PLAN_TIERS,
  PLANS,
  type BillingInterval,
  type PlanTier,
  formatMonthlyEquivalent,
  planPrice,
} from "~/lib/plans";
import {
  resolvePricingPlanCta,
  resolvePricingViewerState,
  type PricingPlanCta,
} from "~/lib/pricing-plan-cta";
import type { SubscriptionAction } from "~/lib/subscription-action";
import { cn } from "~/lib/utils";

const PRICING_PLAN_CONTENT: Record<
  PlanTier,
  { description: string; items: readonly string[]; featured: boolean }
> = {
  free: {
    description: "Best for one-off searches and casual inventory checks.",
    items: [
      `${FREE_DAILY_SEARCH_LIMIT} searches per day`,
      "Keyword and VIN search",
      "Full results after creating a free account",
      "No credit card required",
    ],
    featured: false,
  },
  lite: {
    description: "For serious searchers who need filters and saved searches.",
    items: [
      "Everything in Free",
      "Unlimited searches",
      "Advanced filters: yard, make, year, color, state, lot",
      "Unlimited saved searches",
    ],
    featured: false,
  },
  full: {
    description:
      "Best for repeat parts hunters, rebuilders, and ongoing searches.",
    items: [
      "Everything in Lite",
      "Email alerts when new matches arrive",
      "Discord alerts when new matches arrive",
      "Control alerts separately for each saved search",
    ],
    featured: true,
  },
};

export function PricingPlansSection({
  initialIsRegistered,
}: {
  initialIsRegistered: boolean;
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
        className="border-border mx-auto flex w-fit border-b"
        aria-label="Billing interval"
        role="group"
      >
        <button
          type="button"
          className={cn(
            "focus-visible:ring-ring/50 -mb-px border-b px-4 pb-2 text-sm font-medium transition-colors outline-none focus-visible:rounded-sm focus-visible:ring-[3px]",
            interval === "monthly"
              ? "border-foreground text-foreground"
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
            "focus-visible:ring-ring/50 -mb-px border-b px-4 pb-2 text-sm font-medium transition-colors outline-none focus-visible:rounded-sm focus-visible:ring-[3px]",
            interval === "annual"
              ? "border-foreground text-foreground"
              : "text-muted-foreground hover:text-foreground border-transparent",
          )}
          aria-pressed={interval === "annual"}
          onClick={() => setInterval("annual")}
        >
          Annual
        </button>
      </div>

      <div className="mt-8 grid gap-4 lg:grid-cols-3">
        {PLAN_TIERS.map((tier) => {
          const content = PRICING_PLAN_CONTENT[tier];
          const isFree = tier === "free";
          const cta = resolvePricingPlanCta({
            viewer,
            tier,
            interval,
            account: subscriptionState,
          });
          return (
            <PricingPlanCard
              key={tier}
              eyebrow={PLANS[tier].name}
              price={isFree ? "$0" : `$${planPrice(tier, interval)}`}
              intervalLabel={
                isFree
                  ? ""
                  : interval === "annual"
                    ? `/yr (${formatMonthlyEquivalent(tier)}/mo)`
                    : "/mo"
              }
              description={content.description}
              items={content.items}
              featured={content.featured}
              cta={
                <PricingPlanCtaButton
                  cta={cta}
                  featured={content.featured}
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
  onAction,
}: {
  cta: PricingPlanCta;
  featured: boolean;
  onAction(action: SubscriptionAction): void;
}) {
  const variant = featured ? "default" : "outline";
  switch (cta.kind) {
    case "disabled":
      return (
        <Button variant={variant} className="w-full" disabled>
          {cta.label}
        </Button>
      );
    case "signup":
      return (
        <Button asChild variant={variant} className="w-full">
          <Link href={cta.href}>{cta.label}</Link>
        </Button>
      );
    case "checkout":
      return (
        <Button
          variant={variant}
          className="w-full"
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
          className="w-full"
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

function PricingPlanCard({
  eyebrow,
  price,
  intervalLabel,
  description,
  items,
  cta,
  featured = false,
}: {
  eyebrow: string;
  price: string;
  intervalLabel: string;
  description: string;
  items: readonly string[];
  cta: React.ReactNode;
  featured?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex h-full flex-col rounded-lg border p-6",
        featured && "border-primary bg-primary/5",
      )}
    >
      <p className="text-muted-foreground text-sm font-medium">{eyebrow}</p>
      <h2 className="mt-2 text-3xl font-semibold tracking-tight">
        {price}
        <span className="text-muted-foreground text-base font-normal">
          {intervalLabel}
        </span>
      </h2>
      <p className="text-muted-foreground mt-3 text-sm text-pretty">
        {description}
      </p>
      <ul className="mt-6 space-y-3 text-sm">
        {items.map((item) => (
          <li key={item} className="flex gap-2">
            <span className="text-primary mt-0.5 inline-flex size-4 shrink-0 items-center justify-center">
              •
            </span>
            <span className="text-muted-foreground">{item}</span>
          </li>
        ))}
      </ul>
      <div className="mt-auto pt-6">{cta}</div>
    </div>
  );
}
