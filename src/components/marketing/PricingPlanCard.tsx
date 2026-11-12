"use client";

import { Check } from "lucide-react";
import type { ReactNode } from "react";
import {
  PLANS,
  formatMonthlyEquivalent,
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
  const plan = PLANS[tier];
  const details = PLAN_DETAILS[tier];
  const price =
    tier !== "free" && interval === "annual"
      ? formatMonthlyEquivalent(tier)
      : `$${plan.monthlyPrice}`;

  // The featured plan is the ink plate; its price is the amber figure.
  return (
    <article
      className={cn(
        "border-ink flex h-full flex-col border-2 p-6 lg:p-8",
        featured ? "bg-board text-board-ink" : "bg-paper-3 dark:bg-paper",
      )}
    >
      <Heading className="text-title leading-tight font-extrabold">
        {plan.name}
      </Heading>
      <p
        className={cn(
          "mt-2 min-h-12 text-sm text-pretty",
          featured ? "text-board-muted" : "text-ink-2",
        )}
      >
        {details.description}
      </p>
      <p className="mt-8 flex items-baseline gap-2">
        <span
          className={cn(
            "text-[3.25rem] leading-none font-extrabold tracking-[-0.04em]",
            featured && "text-figure",
          )}
        >
          {price}
        </span>
        <span
          className={cn(
            "text-sm",
            featured ? "text-board-muted" : "text-ink-2",
          )}
        >
          / month
        </span>
      </p>
      <p
        className={cn(
          "mt-3 text-sm",
          featured ? "text-board-muted" : "text-ink-2",
        )}
      >
        {tier === "free"
          ? "Free to use"
          : interval === "annual"
            ? `$${plan.annualPrice} billed annually`
            : `$${plan.monthlyPrice * 12} / year, billed monthly`}
      </p>
      <div className="mt-8">{cta}</div>
      <ul
        className={cn(
          "mt-8 space-y-3 border-t-2 pt-6 text-sm",
          featured ? "border-board-rule" : "border-ink",
        )}
      >
        {details.features.map((feature) => (
          <li key={feature} className="flex items-start gap-3">
            <Check className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span className={featured ? "text-board-muted" : "text-ink-2"}>
              {feature}
            </span>
          </li>
        ))}
      </ul>
    </article>
  );
}
