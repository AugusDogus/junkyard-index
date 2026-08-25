"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "~/components/ui/button";
import { Badge } from "~/components/ui/badge";
import { useSession } from "~/lib/auth-client";
import { AnalyticsEvents } from "~/lib/analytics-events";
import posthog from "posthog-js";
import { isRegisteredSessionUser } from "~/lib/session-user";
import { subscriptionReturnTo } from "~/lib/subscription-selection";
import {
  FREE_DAILY_SEARCH_LIMIT,
  PLAN_TIERS,
  PLANS,
  type BillingInterval,
  type PaidPlanTier,
  type PlanTier,
  formatMonthlyEquivalent,
  planPrice,
} from "~/lib/plans";
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
      "Unlimited searches",
      "Advanced filters: yard, make, year, color, state, lot",
      "Unlimited saved searches",
      "Everything in Free",
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
      "Faster follow-up on hard-to-find donor vehicles",
    ],
    featured: true,
  },
};

export function PricingPlansSection() {
  const [interval, setInterval] = useState<BillingInterval>("monthly");
  const { data: session } = useSession();
  // Anonymous guest sessions can't check out: Polar would bind the
  // subscription to a user that Better Auth deletes on account conversion.
  const isLoggedIn = isRegisteredSessionUser(session?.user);

  const handleCheckout = (tier: PaidPlanTier, ctaLocation: string) => {
    posthog.capture(AnalyticsEvents.CHECKOUT_INITIATED, {
      source: "pricing_flow",
      source_page: "pricing",
      cta_location: ctaLocation,
      plan_tier: tier,
      billing_interval: interval,
    });
    window.location.assign(subscriptionReturnTo({ tier, interval }));
  };

  return (
    <div>
      <div className="flex items-center justify-center gap-2">
        <Button
          type="button"
          variant={interval === "monthly" ? "default" : "outline"}
          size="sm"
          onClick={() => setInterval("monthly")}
        >
          Monthly
        </Button>
        <Button
          type="button"
          variant={interval === "annual" ? "default" : "outline"}
          size="sm"
          onClick={() => setInterval("annual")}
        >
          Annual
          <Badge className="ml-1">Save with annual</Badge>
        </Button>
      </div>

      <div className="mt-8 grid gap-4 lg:grid-cols-3">
        {PLAN_TIERS.map((tier) => {
          const content = PRICING_PLAN_CONTENT[tier];
          const isFree = tier === "free";
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
                isFree ? (
                  <Button asChild variant="outline" className="w-full">
                    <Link href="/auth/sign-up">Create Free Account</Link>
                  </Button>
                ) : isLoggedIn ? (
                  <Button
                    variant={content.featured ? "default" : "outline"}
                    className="w-full"
                    onClick={() => void handleCheckout(tier, `${tier}_plan`)}
                  >
                    Upgrade to {PLANS[tier].name}
                  </Button>
                ) : (
                  <Button
                    asChild
                    variant={content.featured ? "default" : "outline"}
                    className="w-full"
                  >
                    <Link href="/auth/sign-up?returnTo=%2Fpricing">
                      Get {PLANS[tier].name}
                    </Link>
                  </Button>
                )
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
        "rounded-lg border p-6",
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
      <div className="mt-6">{cta}</div>
    </div>
  );
}
