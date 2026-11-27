"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { ReturnTo } from "~/lib/return-to";

type AuthSwitchRoute = "sign-in" | "sign-up";

interface AuthSwitchLinkProps {
  route: AuthSwitchRoute;
  children: string;
}

/**
 * Links the sign-in and sign-up forms to each other, keeping the visitor's
 * return path. The prerendered page links without it, since the CDN serves
 * one page whatever the query; the browser adds it once the page loads.
 */
export function AuthSwitchLink({ route, children }: AuthSwitchLinkProps) {
  return (
    <Suspense
      fallback={<SwitchLink href={`/auth/${route}`}>{children}</SwitchLink>}
    >
      <CurrentSwitchLink route={route}>{children}</CurrentSwitchLink>
    </Suspense>
  );
}

function CurrentSwitchLink({ route, children }: AuthSwitchLinkProps) {
  const returnTo = ReturnTo.parse(useSearchParams().get("returnTo"));
  return (
    <SwitchLink
      href={`/auth/${route}?returnTo=${encodeURIComponent(returnTo)}`}
    >
      {children}
    </SwitchLink>
  );
}

function SwitchLink({ href, children }: { href: string; children: string }) {
  return (
    <Link href={href} className="text-signal hover:underline">
      {children}
    </Link>
  );
}
