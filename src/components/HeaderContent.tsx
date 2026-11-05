"use client";

import Link from "next/link";
import { HeaderAuthButtons } from "./HeaderAuthButtons";
import { SessionHeaderAuthButtons } from "./SessionHeaderAuthButtons";

type HeaderUser = { name: string; email: string; image?: string | null };

/**
 * Where the header learns who is signed in: from the request while rendering,
 * or in the browser on pages served from the CDN.
 */
export type HeaderAuth =
  | { kind: "server"; user: HeaderUser | null }
  | { kind: "client" };

interface HeaderContentProps {
  auth: HeaderAuth;
}

export function HeaderContent({ auth }: HeaderContentProps) {
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
          <nav aria-label="Main" className="hidden sm:block">
            <Link
              href="/junkyards"
              className="text-muted-foreground hover:text-foreground text-sm transition-colors"
            >
              Junkyards
            </Link>
          </nav>
          <div className="flex-1" />
          <div className="flex shrink-0 items-center gap-2 sm:gap-4">
            {auth.kind === "server" ? (
              <HeaderAuthButtons user={auth.user} />
            ) : (
              <SessionHeaderAuthButtons />
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
