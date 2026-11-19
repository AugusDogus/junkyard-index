"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Button } from "~/components/ui/button";
import { ReturnTo } from "~/lib/return-to";

// Render the same placeholder on the server and during hydration, before
// mounting the account menu and its Radix-generated IDs in the browser.
const UserMenu = dynamic(
  () => import("~/components/auth/UserMenu").then((module) => module.UserMenu),
  { ssr: false, loading: () => <div className="size-8" aria-hidden="true" /> },
);

interface HeaderAuthButtonsProps {
  user: { name: string; email: string; image?: string | null } | null;
}

export function HeaderAuthButtons({ user }: HeaderAuthButtonsProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const query = searchParams.toString();
  const returnTo = ReturnTo.parse(
    pathname.startsWith("/auth/")
      ? searchParams.get("returnTo")
      : pathname + (query ? `?${query}` : ""),
  );

  return user ? (
    <UserMenu user={user} />
  ) : (
    <Button asChild variant="outline" size="sm" className="h-11 px-4">
      <Link href={`/auth/sign-in?returnTo=${encodeURIComponent(returnTo)}`}>
        Sign in
      </Link>
    </Button>
  );
}
