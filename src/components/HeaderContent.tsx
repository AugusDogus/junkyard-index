"use client";

import { Search } from "lucide-react";
import Link from "next/link";
import { Button } from "~/components/ui/button";
import { useSearchVisibilityOptional } from "~/context/SearchVisibilityContext";

interface HeaderContentProps {
  authSlot?: React.ReactNode;
  statusSlot?: React.ReactNode;
  statusSeparatorSlot?: React.ReactNode;
}

export function HeaderContent({
  authSlot,
  statusSlot,
  statusSeparatorSlot,
}: HeaderContentProps) {
  const searchCtx = useSearchVisibilityOptional();
  const showMobileSearch = searchCtx?.searchBarOffscreen ?? false;

  return (
    <header className="bg-card sticky top-0 z-50 border-b shadow-sm">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex h-16 items-center gap-4">
          <div className="flex shrink-0 items-center">
            <Link
              href="/"
              data-brand-link
              className="text-foreground text-2xl font-bold"
            >
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
            {statusSlot}
            {statusSeparatorSlot}
            {authSlot}
          </div>
        </div>
      </div>
    </header>
  );
}
