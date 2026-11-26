"use client";

import { Check } from "lucide-react";
import { useInView } from "motion/react";
import { useRef, type ReactNode } from "react";
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
      "Year range and distance radius filters",
      "The first 24 results of every search",
      "No credit card required",
    ],
  },
  lite: {
    description: "Narrow your results and save your searches.",
    features: [
      "Everything in Free",
      "Every result, not just the first 24",
      "Filter by source, make, color, state, and yard",
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
  const price =
    tier !== "free" && interval === "annual"
      ? formatMonthlyEquivalent(tier)
      : `$${plan.monthlyPrice}`;

  // The featured plan is the board plate with its price in the figure colour.
  // A light travels around its 1px frame while the card is on screen
  // (.pricing-plan-border-beam in globals.css).
  return (
    <article
      ref={ref}
      className={cn(
        "relative isolate h-full",
        featured ? "featured-pricing-plan bg-board-rule p-px" : "",
      )}
      data-animated={featured && inView}
    >
      {featured && (
        <>
          <div
            className="pricing-plan-glow pointer-events-none absolute -inset-1.5 -z-10 overflow-hidden"
            aria-hidden="true"
          >
            <div className="pricing-plan-border-beam absolute -inset-full" />
          </div>
          <div
            className="pointer-events-none absolute inset-0 overflow-hidden"
            aria-hidden="true"
          >
            <div className="pricing-plan-border-beam absolute -inset-full" />
          </div>
        </>
      )}
      <div
        className={cn(
          "relative flex h-full flex-col p-6 lg:p-8",
          featured
            ? "bg-board text-board-ink"
            : "border-rule-strong bg-paper-3 dark:bg-paper border",
        )}
      >
        <Heading className="text-title leading-tight font-medium">
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
              "text-[3.25rem] leading-none font-medium tracking-[-0.04em]",
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
            "mt-8 space-y-3 border-t pt-6 text-sm",
            featured ? "border-board-rule" : "border-rule-strong",
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
      </div>
    </article>
  );
}
