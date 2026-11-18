import type { Metadata } from "next";
import { AppProviders } from "~/components/AppProviders";

export const metadata: Metadata = {
  title: "Request a Yard",
  robots: { index: false, follow: true },
  description:
    "Know a salvage yard we don't have yet? Submit a request and we'll look into adding it to Junkyard Index.",
  alternates: { canonical: "/request-yard" },
};

export default function RequestYardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AppProviders>{children}</AppProviders>;
}
