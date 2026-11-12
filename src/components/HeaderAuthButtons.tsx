"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Button } from "~/components/ui/button";
import { Analytics } from "~/lib/analytics";
import { AnalyticsEvents } from "~/lib/analytics-events";
import { cn } from "~/lib/utils";

// Only signed-in visitors render the menu, so its dropdown, billing, and
// session code load for them alone.
const UserMenu = dynamic(() =>
  import("~/components/auth/UserMenu").then((module) => module.UserMenu),
);

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
          className="hidden sm:inline-flex sm:h-11 sm:px-4"
        >
          <Link
            href="/pricing"
            onClick={() =>
              Analytics.capture(AnalyticsEvents.PRICING_CTA_CLICKED, {
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
          className={cn(
            "sm:h-11 sm:px-4",
            !hasPageSearch && "hidden sm:inline-flex",
          )}
        >
          <Link href="/auth/sign-in">Sign in</Link>
        </Button>
      )}
      {!hasPageSearch && (
        <Button asChild size="sm" className="sm:h-11 sm:px-4">
          <Link href="/search">Search</Link>
        </Button>
      )}
      {user && <UserMenu user={user} />}
    </div>
  );
}
