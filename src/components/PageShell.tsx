import type { ReactNode } from "react";
import { Footer } from "~/components/Footer";
import { Header } from "~/components/Header";
import { PublicHeader } from "~/components/PublicHeader";

const WIDTH_CLASSES = {
  narrow: "max-w-xl",
  wide: "max-w-3xl",
  workspace: "max-w-6xl",
} as const;

/**
 * `request` reads the session while rendering, so the page renders on every
 * request. `static` reads nothing from the request: the header loads the
 * session in the browser and the footer links to the status page, so the
 * page is served from the CDN.
 */
type PageShellRendering = "request" | "static";

export function PageShell({
  children,
  width = "narrow",
  rendering = "request",
}: {
  children: ReactNode;
  width?: keyof typeof WIDTH_CLASSES;
  rendering?: PageShellRendering;
}) {
  return (
    <div className="bg-background flex min-h-dvh flex-col">
      {rendering === "static" ? <PublicHeader /> : <Header />}
      <main
        className={`mx-auto w-full flex-1 px-4 py-12 sm:px-6 lg:px-8 ${WIDTH_CLASSES[width]}`}
      >
        {children}
      </main>
      {rendering === "static" ? <Footer status="link" /> : <Footer />}
    </div>
  );
}
