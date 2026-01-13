"use client";

import Link from "next/link";
import { Button } from "~/components/ui/button";
import { UserMenu } from "~/components/auth/UserMenu";

interface HeaderAuthButtonsProps {
  user: { name: string; email: string; image?: string | null } | null;
}

export function HeaderAuthButtons({ user }: HeaderAuthButtonsProps) {
  if (user) {
    return <UserMenu user={user} />;
  }

  return (
    <Button asChild variant="outline" size="sm">
      <Link href="/auth/sign-in">Sign In</Link>
    </Button>
  );
}
