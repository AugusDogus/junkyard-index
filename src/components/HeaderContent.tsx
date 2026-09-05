"use client";

import Link from "next/link";
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
  return (
    <header className="bg-background sticky top-0 z-50 border-b shadow-sm">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex h-16 items-center gap-3 sm:gap-4">
          <div className="flex shrink-0 items-center">
            <Link
              href="/"
              data-brand-link
              className="text-foreground text-xl font-bold sm:text-2xl"
            >
              Junkyard Index
            </Link>
          </div>
          <div className="flex-1" />
          <div className="flex shrink-0 items-center gap-2 sm:gap-4">
            {statusData && (
              <>
                <HeaderStatusIndicator data={statusData} />
                <div
                  className="bg-border hidden h-5 w-px sm:block"
                  aria-hidden="true"
                />
              </>
            )}
            <HeaderAuthButtons user={user} />
          </div>
        </div>
      </div>
    </header>
  );
}
