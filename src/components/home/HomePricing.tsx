import { getSessionCookie } from "better-auth/cookies";
import { headers } from "next/headers";
import { Suspense } from "react";
import { PricingPlansSection } from "~/components/marketing/PricingPlansSection";

export async function HomePricing() {
  const initialIsRegistered = Boolean(
    getSessionCookie(new Headers(await headers())),
  );

  return (
    <section
      id="pricing"
      aria-labelledby="home-pricing-title"
      className="border-t"
    >
      <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 sm:py-24 lg:px-8">
        <div className="mx-auto mb-10 max-w-xl text-center sm:mb-12">
          <h2
            id="home-pricing-title"
            className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl"
          >
            Pricing
          </h2>
          <p className="text-muted-foreground mt-4 text-base text-pretty">
            Search for free. Add filters, saved searches, or alerts when you
            need them.
          </p>
        </div>
        <Suspense>
          <PricingPlansSection
            initialIsRegistered={initialIsRegistered}
            sourcePage="home"
          />
        </Suspense>
      </div>
    </section>
  );
}
