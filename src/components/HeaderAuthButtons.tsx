"use client";

import Link from "next/link";
import { Button } from "~/components/ui/button";
import { UserMenu } from "~/components/auth/UserMenu";
import posthog from "posthog-js";
import { AnalyticsEvents } from "~/lib/analytics-events";

interface HeaderAuthButtonsProps {
  user: { name: string; email: string; image?: string | null } | null;
}

export function HeaderAuthButtons({ user }: HeaderAuthButtonsProps) {
  if (user) {
    return <UserMenu user={user} />;
  }

  return (
    <div className="flex items-center gap-2">
      <Button asChild variant="ghost" size="sm" className="hidden sm:inline-flex">
        <Link
          href="/pricing"
          onClick={() =>
            posthog.capture(AnalyticsEvents.PRICING_CTA_CLICKED, {
              source_page: "header",
              cta_location: "header_pricing",
              is_logged_in: false,
            })
          }
        >
          Pricing
        </Link>
      </Button>
      <Button asChild variant="outline" size="sm" className="hidden sm:inline-flex">
        <Link href="/auth/sign-in">Sign In</Link>
      </Button>
      <Button asChild size="sm">
        <Link href="/auth/sign-up">Create Free Account</Link>
      </Button>
    </div>
  );
}
