"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Button } from "~/components/ui/button";
import { UserMenu } from "~/components/auth/UserMenu";
import posthog from "posthog-js";
import { AnalyticsEvents } from "~/lib/analytics-events";
import { cn } from "~/lib/utils";

interface HeaderAuthButtonsProps {
  user: { name: string; email: string; image?: string | null } | null;
}

export function HeaderAuthButtons({ user }: HeaderAuthButtonsProps) {
  const pathname = usePathname();
  const isLandingPage = pathname === "/" || pathname === "/home";
  const hasPageSearch = isLandingPage || pathname === "/search";

  return (
    <div className="flex items-center gap-2">
      {!user && isLandingPage && (
        <Button
          asChild
          variant="ghost"
          size="sm"
          className="hidden sm:inline-flex"
        >
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
      )}
      {!user && (
        <Button
          asChild
          variant="outline"
          size="sm"
          className={cn(!hasPageSearch && "hidden sm:inline-flex")}
        >
          <Link href="/auth/sign-in">Sign in</Link>
        </Button>
      )}
      {!hasPageSearch && (
        <Button asChild size="sm">
          <Link href="/search">Search</Link>
        </Button>
      )}
      {user && <UserMenu user={user} />}
    </div>
  );
}
