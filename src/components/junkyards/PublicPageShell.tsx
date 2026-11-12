import type { ReactNode } from "react";
import { Footer } from "~/components/Footer";
import { PublicHeader } from "~/components/PublicHeader";

/** Header, main, and footer for pages served from the CDN. */
export function PublicPageShell({ children }: { children: ReactNode }) {
  return (
    <div className="bg-background flex min-h-dvh flex-col">
      <PublicHeader />
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6 sm:py-10 lg:px-8">
        {children}
      </main>
      <Footer status="link" />
    </div>
  );
}
