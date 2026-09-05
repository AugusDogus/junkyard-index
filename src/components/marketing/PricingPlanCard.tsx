"use client";

import { Check } from "lucide-react";
import { useInView } from "motion/react";
import { useRef, type ReactNode } from "react";
import {
  PLANS,
  formatMonthlyEquivalent,
  planPrice,
  type BillingInterval,
  type PlanTier,
} from "~/lib/plans";
import { cn } from "~/lib/utils";

const PLAN_DETAILS: Record<
  PlanTier,
  { description: string; features: readonly string[] }
> = {
  free: {
    description: "Look up vehicles across the yards we index.",
    features: [
      "Unlimited searches",
      "Search by year, make, model, or VIN",
      "Full results with a free account",
      "No credit card required",
    ],
  },
  lite: {
    description: "Narrow your results and save your searches.",
    features: [
      "Everything in Free",
      "Filter by yard, year, make, color, state, and lot",
      "Unlimited saved searches",
      "Keep your filters between visits",
    ],
  },
  full: {
    description: "Get notified when a matching vehicle arrives.",
    features: [
      "Everything in Lite",
      "New vehicle alerts by email",
      "New vehicle alerts in Discord",
      "Choose alerts for each saved search",
    ],
  },
};

export function PricingPlanCard({
  tier,
  interval,
  featured,
  cta,
  heading: Heading,
}: {
  tier: PlanTier;
  interval: BillingInterval;
  featured: boolean;
  cta: ReactNode;
  heading: "h2" | "h3";
}) {
  const ref = useRef<HTMLElement>(null);
  const inView = useInView(ref);
  const plan = PLANS[tier];
  const details = PLAN_DETAILS[tier];
  const price = tier === "free" ? 0 : planPrice(tier, interval);

  return (
    <article
      ref={ref}
      className={cn(
        "bg-border relative isolate rounded-2xl p-px",
        featured && "featured-pricing-plan bg-foreground/20 shadow-sm",
      )}
      data-animated={featured && inView}
    >
      {featured && (
        <div
          className="pointer-events-none absolute inset-0 overflow-hidden rounded-2xl"
          aria-hidden="true"
        >
          <div className="pricing-plan-border-beam absolute -inset-full" />
        </div>
      )}
      <div className="bg-card relative flex h-full flex-col rounded-[15px] p-6 lg:p-8">
        <Heading className="text-xl font-semibold">{plan.name}</Heading>
        <p className="text-muted-foreground mt-2 min-h-10 text-sm text-pretty">
          {details.description}
        </p>
        <p className="mt-7 flex items-baseline gap-1.5 tabular-nums">
          <span className="text-4xl font-semibold tracking-tight">
            ${price}
          </span>
          <span className="text-muted-foreground text-sm">
            / {tier !== "free" && interval === "annual" ? "year" : "month"}
          </span>
        </p>
        <p className="text-muted-foreground mt-2 text-sm tabular-nums">
          {tier === "free"
            ? "Free to use"
            : interval === "annual"
              ? `${formatMonthlyEquivalent(tier)} / month, billed annually`
              : `Or $${plan.annualPrice} / year`}
        </p>
        <div className="mt-7">{cta}</div>
        <ul className="mt-7 space-y-3 border-t pt-6 text-sm">
          {details.features.map((feature) => (
            <li key={feature} className="flex items-start gap-3">
              <Check className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <span className="text-muted-foreground">{feature}</span>
            </li>
          ))}
        </ul>
      </div>
    </article>
  );
}
