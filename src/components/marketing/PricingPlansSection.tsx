"use client";

import { useState } from "react";
import Link from "next/link";
import posthog from "posthog-js";
import { Button } from "~/components/ui/button";
import { Badge } from "~/components/ui/badge";
import { AnalyticsEvents } from "~/lib/analytics-events";
import { authClient, useSession } from "~/lib/auth-client";
import {
  FREE_DAILY_SEARCH_LIMIT,
  PLANS,
  type BillingInterval,
  checkoutSlugFor,
  formatMonthlyEquivalent,
  planPrice,
} from "~/lib/plans";
import { cn } from "~/lib/utils";

const FREE_PLAN_ITEMS = [
  `${FREE_DAILY_SEARCH_LIMIT} searches per day`,
  "Keyword and VIN search",
  "Full results after creating a free account",
  "No credit card required",
];

const LITE_PLAN_ITEMS = [
  "Unlimited searches",
  "Advanced filters: yard, make, year, color, state, lot",
  "Unlimited saved searches",
  "Everything in Free",
];

const FULL_PLAN_ITEMS = [
  "Everything in Lite",
  "Email alerts when new matches arrive",
  "Discord alerts when new matches arrive",
  "Faster follow-up on hard-to-find donor vehicles",
];

export function PricingPlansSection() {
  const [interval, setInterval] = useState<BillingInterval>("monthly");
  const { data: session } = useSession();
  // Anonymous guest sessions can't check out: Polar would bind the
  // subscription to a user that Better Auth deletes on account conversion.
  const isLoggedIn =
    !!session?.user && !session.user.isAnonymous;

  const handleCheckout = async (tier: "lite" | "full", ctaLocation: string) => {
    posthog.capture(AnalyticsEvents.CHECKOUT_INITIATED, {
      source: "pricing_page",
      cta_location: ctaLocation,
      plan_tier: tier,
      billing_interval: interval,
    });
    try {
      await authClient.checkout({ slug: checkoutSlugFor(tier, interval) });
    } catch (error) {
      console.error("Failed to open checkout:", error);
    }
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
        <PricingPlanCard
          eyebrow={PLANS.free.name}
          price="$0"
          intervalLabel=""
          description="Best for one-off searches and casual inventory checks."
          items={FREE_PLAN_ITEMS}
          featured={false}
          cta={
            <Button asChild variant="outline" className="w-full">
              <Link href="/auth/sign-up">Create Free Account</Link>
            </Button>
          }
        />
        <PricingPlanCard
          eyebrow={PLANS.lite.name}
          price={`$${planPrice("lite", interval)}`}
          intervalLabel={
            interval === "annual"
              ? `/yr (${formatMonthlyEquivalent("lite")}/mo)`
              : "/mo"
          }
          description="For serious searchers who need filters and saved searches."
          items={LITE_PLAN_ITEMS}
          featured={false}
          cta={
            isLoggedIn ? (
              <Button
                variant="outline"
                className="w-full"
                onClick={() => void handleCheckout("lite", "lite_plan")}
              >
                Upgrade to Lite
              </Button>
            ) : (
              <Button asChild variant="outline" className="w-full">
                <Link href="/auth/sign-up?returnTo=%2Fpricing">Get Lite</Link>
              </Button>
            )
          }
        />
        <PricingPlanCard
          eyebrow={PLANS.full.name}
          price={`$${planPrice("full", interval)}`}
          intervalLabel={
            interval === "annual"
              ? `/yr (${formatMonthlyEquivalent("full")}/mo)`
              : "/mo"
          }
          description="Best for repeat parts hunters, rebuilders, and ongoing searches."
          items={FULL_PLAN_ITEMS}
          featured
          cta={
            isLoggedIn ? (
              <Button
                className="w-full"
                onClick={() => void handleCheckout("full", "full_plan")}
              >
                Upgrade to Full
              </Button>
            ) : (
              <Button asChild className="w-full">
                <Link href="/auth/sign-up?returnTo=%2Fpricing">Get Full</Link>
              </Button>
            )
          }
        />
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
  items: string[];
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
