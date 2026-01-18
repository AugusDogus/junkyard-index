import "~/styles/globals.css";

import { Analytics } from "@vercel/analytics/next";
import { type Metadata } from "next";
import { Geist } from "next/font/google";
import { NuqsAdapter } from "nuqs/adapters/next/app";
import { Toaster } from "~/components/ui/sonner";

import { TailwindIndicator } from "~/components/tailwind-indicator";
import { ThemeProvider } from "~/components/theme/theme-provider";
import { TRPCReactProvider } from "~/trpc/react";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://junkyardindex.com";

export const metadata: Metadata = {
  metadataBase: new URL(APP_URL),
  title: {
    default: "Junkyard Index - Search Salvage Yard Inventory Nationwide",
    template: "%s | Junkyard Index",
  },
  description:
    "Search salvage yard inventory across the nation. Find used auto parts from LKQ Pick Your Part, Row52, and more. Save searches and get email alerts when new vehicles arrive.",
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
  openGraph: {
    type: "website",
    locale: "en_US",
    url: APP_URL,
    siteName: "Junkyard Index",
    title: "Junkyard Index - Search Salvage Yard Inventory Nationwide",
    description:
      "Search salvage yard inventory across the nation. Find used auto parts from LKQ Pick Your Part, Row52, and more.",
  },
  twitter: {
    card: "summary_large_image",
    title: "Junkyard Index - Search Salvage Yard Inventory Nationwide",
    description:
      "Search salvage yard inventory across the nation. Find used auto parts from LKQ Pick Your Part, Row52, and more.",
  },
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

const geist = Geist({
  subsets: ["latin"],
  variable: "--font-geist-sans",
});

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${geist.variable}`} suppressHydrationWarning>
      <body>
        <NuqsAdapter>
          <TRPCReactProvider>
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
          </TRPCReactProvider>
        </NuqsAdapter>
        <Toaster />
      </body>
    </html>
  );
}
