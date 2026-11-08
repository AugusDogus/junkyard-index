import "~/styles/globals.css";

import { Analytics } from "@vercel/analytics/next";
import { type Metadata } from "next";
import { Chivo_Mono } from "next/font/google";

import { TailwindIndicator } from "~/components/tailwind-indicator";
import { ThemeProvider } from "~/components/theme/theme-provider";
import { SITE_OPEN_GRAPH } from "~/lib/site-metadata";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://junkyardindex.com";

export const metadata: Metadata = {
  metadataBase: new URL(APP_URL),
  title: {
    default: "Junkyard Index",
    template: "%s | Junkyard Index",
  },
  description:
    "Search salvage yard inventory across major yard networks, save searches, and get alerts when new donor vehicles arrive.",
  keywords: [
    "junkyard",
    "salvage yard",
    "auto parts",
    "used car parts",
    "pick your part",
    "LKQ",
    "Row52",
    "self-service auto parts",
    "car parts search",
    "junkyard inventory",
  ],
  authors: [{ name: "Junkyard Index" }],
  creator: "Junkyard Index",
  // Only site-wide facts. A page's URL, title, and description are its own;
  // pages that want a link preview set them, so none inherits the homepage's.
  openGraph: { ...SITE_OPEN_GRAPH, type: "website" },
  twitter: { card: "summary" },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
  icons: [{ rel: "icon", url: "/favicon.svg" }],
};

// Wayfind sets every glyph in Chivo Mono (src/styles/tokens.css).
const chivoMono = Chivo_Mono({
  subsets: ["latin"],
  variable: "--font-chivo-mono",
  fallback: ["ui-monospace", "monospace"],
});

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${chivoMono.variable} bg-background`}
      suppressHydrationWarning
    >
      <body>
        {/* App-only state (tRPC, URL state, toasts) lives in the interactive
        routes' layouts via AppProviders, so public pages don't ship it. */}
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          {children}
          <Analytics />
          <TailwindIndicator />
        </ThemeProvider>
      </body>
    </html>
  );
}
