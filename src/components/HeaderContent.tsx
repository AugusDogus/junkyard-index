"use client";

import Link from "next/link";
import { ThemeToggle } from "~/components/theme/theme-toggle";
import { HeaderAuthButtons } from "./HeaderAuthButtons";

interface HeaderContentProps {
  user: { name: string; email: string; image?: string | null } | null;
}

export function HeaderContent({ user }: HeaderContentProps) {
  return (
    <header className="bg-card sticky top-0 z-50 border-b shadow-sm">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex h-16 items-center gap-4">
          <div className="flex shrink-0 items-center">
            <Link href="/search" className="text-foreground text-2xl font-bold">
              Junkyard Index
            </Link>
          </div>
          <div className="flex-1" />
          <div className="flex shrink-0 items-center gap-2 sm:gap-4">
            {/* Theme toggle: always visible on desktop, only visible on mobile when logged out */}
            <div className={user ? "hidden sm:block" : ""}>
              <ThemeToggle />
            </div>
            <HeaderAuthButtons user={user} />
          </div>
        </div>
      </div>
    </header>
  );
}
