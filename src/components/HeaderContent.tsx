"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "~/lib/utils";
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
    <header className="bg-paper border-ink sticky top-0 z-50 border-b-2">
      <div className="shell">
        <div className="flex h-16 items-center gap-2 sm:h-18 sm:gap-4 md:gap-8">
          <Link
            href="/"
            data-brand-link
            className="text-ink focus-visible:outline-focus shrink-0 text-lg leading-none font-extrabold tracking-[-0.03em] whitespace-nowrap focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-solid sm:text-xl md:text-2xl"
          >
            Junkyard Index
          </Link>
          <nav aria-label="Main" className="hidden self-stretch sm:flex">
            <MainLinks />
          </nav>
          <div className="flex-1" />
          <div className="flex shrink-0 items-center gap-2 sm:gap-3">
            {auth.kind === "server" ? (
              <HeaderAuthButtons user={auth.user} />
            ) : (
              <SessionHeaderAuthButtons />
            )}
          </div>
        </div>
        {/* No room beside the brand and actions on phones: a slim row below. */}
        <nav aria-label="Main" className="-mt-1 flex h-10 sm:hidden">
          <MainLinks />
        </nav>
      </div>
    </header>
  );
}

function MainLinks() {
  return (
    <>
      <MainLink href="/junkyards">Junkyards</MainLink>
      <MainLink href="/cars">Cars</MainLink>
    </>
  );
}

/** The current section carries a 2px ink bar, like a platform sign's arrow. */
function MainLink({ href, children }: { href: string; children: string }) {
  const pathname = usePathname();
  const current = pathname === href || pathname.startsWith(`${href}/`);
  return (
    <Link
      href={href}
      aria-current={pathname === href ? "page" : current ? "true" : undefined}
      className={cn(
        "board-step focus-visible:outline-focus flex items-center border-b-2 px-3 text-sm font-medium whitespace-nowrap focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-solid first:-ml-3 sm:text-[0.9375rem]",
        current
          ? "border-ink text-ink"
          : "text-ink-2 hover:text-signal border-transparent",
      )}
    >
      {children}
    </Link>
  );
}
