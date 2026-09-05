import { getSessionCookie } from "better-auth/cookies";
import { type Metadata } from "next";
import { headers } from "next/headers";
import { Suspense } from "react";
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

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-16 sm:px-6 sm:py-24 lg:px-8">
        <div>
          <div className="mx-auto max-w-xl text-center">
            <h1 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
              Pricing
            </h1>
            <p className="text-muted-foreground mt-4 text-base text-pretty">
              Search for free. Add filters, saved searches, or alerts when you
              need them.
            </p>
          </div>

          <div className="mt-10 sm:mt-12">
            <Suspense>
              <PricingPlansSection initialIsRegistered={initialIsRegistered} />
            </Suspense>
          </div>

          <div className="bg-muted/40 mt-16 rounded-2xl border p-8 text-center">
            <h2 className="text-2xl font-semibold tracking-tight">
              Keep searching for free.
            </h2>
            <p className="text-muted-foreground mx-auto mt-3 max-w-2xl text-pretty">
              Every plan includes unlimited searches. Create a free account to
              see full results.
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
