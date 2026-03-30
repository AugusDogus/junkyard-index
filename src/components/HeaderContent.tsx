"use client";

import { Search } from "lucide-react";
import Link from "next/link";
import { Button } from "~/components/ui/button";
import { ThemeToggle } from "~/components/theme/theme-toggle";
import { useSearchVisibilityOptional } from "~/context/SearchVisibilityContext";
import { HeaderAuthButtons } from "./HeaderAuthButtons";
import {
  HeaderStatusIndicator,
  type HeaderStatusData,
} from "./HeaderStatusIndicator";

interface HeaderContentProps {
  user: { name: string; email: string; image?: string | null } | null;
  statusData?: HeaderStatusData | null;
}

export function HeaderContent({ user, statusData }: HeaderContentProps) {
  const searchCtx = useSearchVisibilityOptional();
  const showMobileSearch = searchCtx?.searchBarOffscreen ?? false;

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
            {showMobileSearch && (
              <Button
                variant="ghost"
                size="sm"
                className="h-8 w-8 p-0 md:hidden"
                aria-label="Search"
                onClick={() => searchCtx?.scrollToSearch()}
              >
                <Search className="h-4 w-4" />
              </Button>
            )}
            {statusData && (
              <>
                <HeaderStatusIndicator data={statusData} />
                <div className="bg-border h-5 w-px" aria-hidden="true" />
              </>
            )}
            <div className={user || showMobileSearch ? "hidden sm:block" : ""}>
              <ThemeToggle />
            </div>
            <HeaderAuthButtons user={user} />
          </div>
        </div>
      </div>
    </header>
  );
}
