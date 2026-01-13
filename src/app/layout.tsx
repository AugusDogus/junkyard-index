import "~/styles/globals.css";

import { Analytics } from "@vercel/analytics/next";
import { type Metadata } from "next";
import { Geist } from "next/font/google";
import { NuqsAdapter } from "nuqs/adapters/next/app";
import { Toaster } from "~/components/ui/sonner";

import { TailwindIndicator } from "~/components/tailwind-indicator";
import { ThemeProvider } from "~/components/theme/theme-provider";
import { TRPCReactProvider } from "~/trpc/react";

export const metadata: Metadata = {
  title: "PYP Global Search",
  description: "Search across all Pick Your Part salvage yard inventory locations",
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
