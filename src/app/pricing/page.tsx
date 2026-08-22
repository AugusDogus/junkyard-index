import { type Metadata } from "next";
import { Footer } from "~/components/Footer";
import { Header } from "~/components/Header";
import { PricingPlansSection } from "~/components/marketing/PricingPlansSection";
import { TrackedPricingButton } from "~/components/marketing/TrackedPricingButton";

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "Search salvage yard inventory free, upgrade to Lite ($3/mo) for filters and saved searches, or Full ($7/mo) for email and Discord alerts on new matches.",
  alternates: {
    canonical: "/pricing",
  },
};

export default function PricingPage() {
  return (
    <div className="bg-background flex min-h-dvh flex-col">
      <Header />

      <main className="flex-1 px-4 py-16 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-6xl">
          <div className="mx-auto max-w-2xl text-center">
            <p className="text-muted-foreground text-sm font-medium">
              Pricing
            </p>
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
            <PricingPlansSection />
          </div>

          <div className="mt-12 rounded-lg border p-6 text-center">
            <h2 className="text-2xl font-semibold tracking-tight">
              What changes when you upgrade?
            </h2>
            <p className="text-muted-foreground mx-auto mt-3 max-w-2xl text-pretty">
              Search stays simple. The paid value is continuity: unlimited
              searches, advanced filters, saved searches, and alerts when
              inventory changes after you leave.
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
