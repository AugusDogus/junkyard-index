"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense } from "react";
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
    <header className="bg-paper border-rule-strong sticky top-0 z-50 border-b">
      <a
        href="#main-content"
        className="bg-paper text-ink focus-visible:outline-focus fixed top-2 left-2 z-50 -translate-y-[200%] border px-4 py-3 focus:translate-y-0 focus:outline-2"
        onClick={(event) => {
          const main = document.querySelector("main");
          if (!main) return;
          event.preventDefault();
          main.tabIndex = -1;
          main.focus();
          main.scrollIntoView();
        }}
      >
        Skip to content
      </a>
      <div className="shell">
        <div className="flex h-16 items-center gap-2 sm:h-18 sm:gap-4 md:gap-8">
          <Link
            href="/"
            data-brand-link
            className="text-ink focus-visible:outline-focus shrink-0 text-lg leading-none font-medium tracking-[-0.055em] whitespace-nowrap focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-solid sm:text-xl md:text-2xl"
          >
            Junkyard Index
          </Link>
          <nav aria-label="Main" className="hidden self-stretch md:flex">
            <MainLinks />
          </nav>
          <div className="flex-1" />
          <div className="flex shrink-0 items-center gap-2 sm:gap-3">
            <Suspense>
              {auth.kind === "server" ? (
                <HeaderAuthButtons user={auth.user} />
              ) : (
                <SessionHeaderAuthButtons />
              )}
            </Suspense>
          </div>
        </div>
        {/* No room beside the brand and actions on phones: a slim row below. */}
        <nav
          aria-label="Main"
          className="-mt-1 flex h-10 overflow-x-auto [scrollbar-width:none] md:hidden [&::-webkit-scrollbar]:hidden"
        >
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
      <MainLink href="/chains">Chains</MainLink>
      <MainLink href="/map">Map</MainLink>
      <MainLink href="/cars">Cars</MainLink>
      <MainLink href="/pricing">Pricing</MainLink>
      <MainLink href="/search">Search</MainLink>
    </>
  );
}

/** The current section carries a 1px ink rule under its name. */
function MainLink({ href, children }: { href: string; children: string }) {
  const pathname = usePathname();
  const current = pathname === href || pathname.startsWith(`${href}/`);
  return (
    <Link
      href={href}
      aria-current={pathname === href ? "page" : current ? "true" : undefined}
      className={cn(
        "board-step focus-visible:outline-focus flex items-center border-b px-1.5 text-[0.8125rem] font-medium whitespace-nowrap focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-solid first:-ml-1.5 sm:px-3 sm:text-[0.9375rem] sm:first:-ml-3",
        current
          ? "border-ink text-ink"
          : "text-ink-2 hover:text-signal border-transparent",
      )}
    >
      {children}
    </Link>
  );
}
