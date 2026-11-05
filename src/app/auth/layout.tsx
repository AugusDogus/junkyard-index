import type { Metadata } from "next";
import type { ReactNode } from "react";

// Sign-in and account forms: crawlable, so the noindex is seen, but never
// worth a search result.
export const metadata: Metadata = {
  robots: { index: false, follow: true },
};

export default function AuthLayout({ children }: { children: ReactNode }) {
  return children;
}
