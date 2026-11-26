"use client";

import {
  CreditCard,
  Ellipsis,
  LogOut,
  Monitor,
  Moon,
  Settings,
  Sun,
} from "lucide-react";
import { useTheme } from "next-themes";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Button } from "~/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { Analytics } from "~/lib/analytics";
import { useSubscriptionDestination } from "~/hooks/use-subscription-destination";
import { AnalyticsEvents } from "~/lib/analytics-events";
import { signOut, useSession } from "~/lib/auth-client";
import { PLANS } from "~/lib/plans";
import { EnsureAppProviders } from "~/components/AppProviders";
import { ACCOUNT_MENU_FOOTER_LINKS } from "~/components/FooterLinks";
import { TrackedRequestYardLink } from "~/components/TrackedRequestYardLink";
import { env } from "~/env";

interface UserMenuProps {
  user?: { name: string; email: string; image?: string | null } | null;
}

/**
 * The signed-in user menu. It renders on public pages too, which don't load
 * the app providers, and its billing link needs tRPC and toasts.
 */
export function UserMenu(props: UserMenuProps) {
  return (
    <EnsureAppProviders>
      <UserMenuContent {...props} />
    </EnsureAppProviders>
  );
}

function UserMenuContent({ user: initialUser }: UserMenuProps) {
  const router = useRouter();
  const { data: session } = useSession();
  const { setTheme } = useTheme();
  const [isSigningOut, setIsSigningOut] = useState(false);
  // Whether the menu was last used with a keyboard, so closing it returns
  // focus to the trigger only for keyboard users.
  const usedKeyboard = useRef(false);

  // Use session user if available (for real-time updates), otherwise fall back to initial user
  const user = session?.user ?? initialUser;

  const { state: subscriptionState, open: openSubscriptionDestination } =
    useSubscriptionDestination({
      source: "user_menu",
    });
  const hasManageableSubscription =
    subscriptionState.kind === "active" ||
    subscriptionState.kind === "needs_attention";

  if (!user) {
    return null;
  }

  const handleSignOut = async () => {
    Analytics.capture(AnalyticsEvents.SIGN_OUT_CLICKED);
    Analytics.reset();
    setIsSigningOut(true);
    await signOut();
    router.refresh();
  };

  const initials =
    user.name
      ?.split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2) ||
    user.email[0]?.toUpperCase() ||
    "U";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        asChild
        onPointerDown={() => {
          usedKeyboard.current = false;
        }}
        onKeyDown={() => {
          usedKeyboard.current = true;
        }}
      >
        {/* The ring stays put on hover: an ink ring around a photo reads as
            a stray outline. Initials get the quiet ghost-button fill. */}
        <Button
          variant="outline"
          size="sm"
          className="hover:border-rule-strong hover:bg-accent relative size-8 overflow-hidden rounded-full p-0"
        >
          {/* Fill the circle inside the border and clip to it, so the photo
          neither spills past the ring nor leaves a gap at its sides. */}
          {user.image ? (
            <img
              src={user.image}
              alt={user.name || user.email}
              className="size-full rounded-full object-cover"
            />
          ) : (
            <span className="text-xs font-medium">{initials}</span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        className="w-56"
        align="end"
        onKeyDown={() => {
          usedKeyboard.current = true;
        }}
        onPointerDown={() => {
          usedKeyboard.current = false;
        }}
        onPointerDownOutside={() => {
          usedKeyboard.current = false;
        }}
        // Radix returns focus to the trigger on close, and browsers then draw
        // its focus ring even after a tap or click. Return it for keyboards only.
        onCloseAutoFocus={(event) => {
          if (!usedKeyboard.current) event.preventDefault();
        }}
      >
        <DropdownMenuLabel>
          <div className="flex flex-col space-y-1">
            {user.name && (
              <p className="text-sm leading-none font-medium">{user.name}</p>
            )}
            <p className="text-muted-foreground text-xs leading-none">
              {user.email}
            </p>
          </div>
        </DropdownMenuLabel>
        {/* Theme submenu - visible on mobile, hidden on desktop */}
        <DropdownMenuSub>
          <DropdownMenuSubTrigger className="gap-2 sm:hidden">
            <Sun className="mr-2 h-4 w-4 scale-100 rotate-0 dark:scale-0 dark:-rotate-90" />
            <Moon className="absolute h-4 w-4 scale-0 rotate-90 dark:scale-100 dark:rotate-0" />
            Theme
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuItem
              onClick={() => {
                Analytics.capture(AnalyticsEvents.THEME_CHANGED, {
                  theme: "light",
                });
                setTheme("light");
              }}
            >
              <Sun className="mr-2 h-4 w-4" />
              Light
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => {
                Analytics.capture(AnalyticsEvents.THEME_CHANGED, {
                  theme: "dark",
                });
                setTheme("dark");
              }}
            >
              <Moon className="mr-2 h-4 w-4" />
              Dark
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => {
                Analytics.capture(AnalyticsEvents.THEME_CHANGED, {
                  theme: "system",
                });
                setTheme("system");
              }}
            >
              <Monitor className="mr-2 h-4 w-4" />
              System
            </DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSeparator className="sm:hidden" />
        {/* Settings */}
        <DropdownMenuItem onClick={() => router.push("/settings/searches")}>
          <Settings className="mr-2 h-4 w-4" />
          <span>Settings</span>
        </DropdownMenuItem>
        {/* Subscription management */}
        {hasManageableSubscription ? (
          <DropdownMenuItem
            onClick={() => void openSubscriptionDestination({ kind: "manage" })}
          >
            <CreditCard className="mr-2 h-4 w-4" />
            <span>Manage Subscription</span>
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem onClick={() => router.push("/pricing")}>
            <CreditCard className="mr-2 h-4 w-4" />
            <span>Upgrade from ${PLANS.lite.monthlyPrice}/mo</span>
          </DropdownMenuItem>
        )}
        <SiteLinks />
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={isSigningOut} onClick={handleSignOut}>
          <LogOut className="mr-2 h-4 w-4" />
          <span>{isSigningOut ? "Signing out..." : "Sign out"}</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// Touch-sized like the footer links they stand in for, compact from sm up.
const siteLinkClassName = "text-muted-foreground min-h-11 text-xs sm:min-h-8";

/**
 * The footer links the header lacks, behind one row. Paid users scroll
 * /search without end and never reach its footer, so the menu carries them.
 */
function SiteLinks() {
  const statusPageUrl = env.NEXT_PUBLIC_STATUS_PAGE_URL;
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger className="gap-2">
        <Ellipsis className="mr-2 h-4 w-4" />
        More
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent>
        <DropdownMenuGroup aria-label="Site links">
          {ACCOUNT_MENU_FOOTER_LINKS.map((link) => (
            <DropdownMenuItem
              key={link.kind === "static" ? link.href : link.kind}
              asChild
              className={siteLinkClassName}
            >
              {link.kind === "request-yard" ? (
                <TrackedRequestYardLink />
              ) : (
                <Link href={link.href}>{link.label}</Link>
              )}
            </DropdownMenuItem>
          ))}
          {statusPageUrl && (
            <DropdownMenuItem asChild className={siteLinkClassName}>
              <a href={statusPageUrl} target="_blank" rel="noopener noreferrer">
                System status
              </a>
            </DropdownMenuItem>
          )}
        </DropdownMenuGroup>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}
