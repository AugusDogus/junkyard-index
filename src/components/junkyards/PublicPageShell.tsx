import type { ReactNode } from "react";
import { Footer } from "~/components/Footer";
import { PublicHeader } from "~/components/PublicHeader";

/** Header, main, and footer for pages served from the CDN. */
export function PublicPageShell({ children }: { children: ReactNode }) {
  return (
    <div className="bg-background flex min-h-dvh flex-col">
      <PublicHeader />
      <main className="shell flex-1 pt-8 pb-24 sm:pt-12 sm:pb-32">
        {children}
      </main>
      <Footer status="link" />
    </div>
  );
}
