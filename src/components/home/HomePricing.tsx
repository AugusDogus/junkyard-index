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
      className="border-ink border-t-2"
    >
      <div className="shell py-24 sm:py-32">
        <div className="mb-10 grid gap-4 lg:grid-cols-12 lg:items-end lg:gap-8">
          <h2
            id="home-pricing-title"
            className="text-section leading-[1.02] font-extrabold lg:col-span-5"
          >
            Pricing
          </h2>
          <p className="text-ink-2 text-lead text-pretty lg:col-span-6 lg:col-start-7">
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
