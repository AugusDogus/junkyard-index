import { getSessionCookie } from "better-auth/cookies";
import { type Metadata } from "next";
import { headers } from "next/headers";
import { Footer } from "~/components/Footer";
import { Header } from "~/components/Header";
import { PricingPlansSection } from "~/components/marketing/PricingPlansSection";
import { TrackedPricingButton } from "~/components/marketing/TrackedPricingButton";
import { PLANS } from "~/lib/plans";

export const metadata: Metadata = {
  title: "Pricing",
  description: `Search salvage yard inventory free, upgrade to Lite ($${PLANS.lite.monthlyPrice}/mo) for filters and saved searches, or Full ($${PLANS.full.monthlyPrice}/mo) for email and Discord alerts on new matches.`,
  alternates: {
    canonical: "/pricing",
  },
};

export default async function PricingPage() {
  // This is an optimistic first-render hint. The client session remains
  // authoritative after hydration.
  const initialIsRegistered = Boolean(
    getSessionCookie(new Headers(await headers())),
  );

  return (
    <div className="bg-background flex min-h-dvh flex-col">
      <Header />

      <main className="flex-1 px-4 py-16 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-6xl">
          <div className="mx-auto max-w-2xl text-center">
            <p className="text-muted-foreground text-sm font-medium">Pricing</p>
            <h1 className="mt-3 text-4xl font-bold tracking-tight text-balance sm:text-5xl">
              Search free. Upgrade when you want inventory tracked for you.
            </h1>
            <p className="text-muted-foreground mt-4 text-lg text-pretty">
              Free covers everyday searching. Lite unlocks filters and saved
              searches. Full adds email and Discord alerts when new matching
              vehicles arrive.
            </p>
          </div>

          <div className="mt-10">
            <PricingPlansSection initialIsRegistered={initialIsRegistered} />
          </div>

          <div className="mt-12 rounded-lg border p-6 text-center">
            <h2 className="text-2xl font-semibold tracking-tight">
              What changes when you upgrade?
            </h2>
            <p className="text-muted-foreground mx-auto mt-3 max-w-2xl text-pretty">
              Search stays free and unlimited. The paid value is continuity:
              advanced filters, saved searches, and alerts when inventory
              changes after you leave.
            </p>
            <div className="mt-6 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <TrackedPricingButton
                href="/auth/sign-up"
                label="Start Free"
                sourcePage="pricing"
                ctaLocation="bottom_start_free"
                size="lg"
              />
              <TrackedPricingButton
                href="/search"
                label="Search Inventory"
                sourcePage="pricing"
                ctaLocation="bottom_search"
                variant="outline"
                size="lg"
              />
            </div>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}
