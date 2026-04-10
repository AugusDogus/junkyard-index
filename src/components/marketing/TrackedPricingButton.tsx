"use client";

import Link from "next/link";
import posthog from "posthog-js";
import { Button } from "~/components/ui/button";
import { AnalyticsEvents } from "~/lib/analytics-events";
import { cn } from "~/lib/utils";

export function TrackedPricingButton({
  href,
  label,
  sourcePage,
  ctaLocation,
  variant = "default",
  size = "default",
  className,
}: {
  href: string;
  label: string;
  sourcePage: string;
  ctaLocation: string;
  variant?: React.ComponentProps<typeof Button>["variant"];
  size?: React.ComponentProps<typeof Button>["size"];
  className?: string;
}) {
  return (
    <Button asChild variant={variant} size={size} className={cn(className)}>
      <Link
        href={href}
        onClick={() =>
          posthog.capture(AnalyticsEvents.PRICING_CTA_CLICKED, {
            source_page: sourcePage,
            cta_location: ctaLocation,
          })
        }
      >
        {label}
      </Link>
    </Button>
  );
}
