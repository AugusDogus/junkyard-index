import "~/styles/globals.css";

import { Analytics } from "@vercel/analytics/next";
import { type Metadata } from "next";

import { TailwindIndicator } from "~/components/tailwind-indicator";
import { ThemeProvider } from "~/components/theme/theme-provider";
import { brandFont } from "./fonts";
import { rootMetadata } from "./root-metadata";

export const metadata: Metadata = rootMetadata;

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${brandFont.variable} bg-background`}
      suppressHydrationWarning
    >
      <head>
        <link rel="preconnect" href="https://wsrv.nl" />
      </head>
      <body>
        {/* App-only state (tRPC, URL state, toasts) lives in the interactive
        routes' layouts via AppProviders, so public pages don't ship it. */}
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          {children}
          <Analytics />
          <TailwindIndicator />
        </ThemeProvider>
      </body>
    </html>
  );
}
