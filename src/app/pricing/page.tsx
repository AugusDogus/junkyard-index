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

      <main className="shell flex-1 py-16 sm:py-24">
        <div>
          <div className="max-w-2xl">
            <h1 className="text-display-s leading-[1.02] font-extrabold">
              Pricing
            </h1>
            <p className="text-ink-2 text-lead mt-4 text-pretty">
              Search for free. Add filters, saved searches, or alerts when you
              need them.
            </p>
          </div>

          <div className="mt-10 sm:mt-12">
            <Suspense>
              <PricingPlansSection initialIsRegistered={initialIsRegistered} />
            </Suspense>
          </div>

          <div className="bg-paper-2 border-ink mt-20 grid gap-6 border-2 p-6 sm:p-10 lg:grid-cols-12 lg:items-end lg:gap-8">
            <h2 className="text-title leading-tight font-extrabold lg:col-span-5">
              Keep searching for free.
            </h2>
            <p className="text-ink-2 text-pretty lg:col-span-7">
              Every plan includes unlimited searches. Create a free account to
              see full results.
            </p>
            <div className="flex flex-col gap-3 sm:flex-row lg:col-span-12">
              <TrackedPricingButton
                href="/auth/sign-up"
                label="Start Free"
                sourcePage="pricing"
                ctaLocation="bottom_start_free"
                size="xl"
              />
              <TrackedPricingButton
                href="/search"
                label="Search Inventory"
                sourcePage="pricing"
                ctaLocation="bottom_search"
                variant="outline"
                size="xl"
              />
            </div>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}
