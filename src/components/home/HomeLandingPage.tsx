import { ArrowRight, Bell, Car, Search } from "lucide-react";
import { type Metadata } from "next";
import Link from "next/link";
import { Footer } from "~/components/Footer";
import { Header } from "~/components/Header";
import { HomeSearchHero } from "~/components/home/HomeSearchHero";
import { TrackedPricingButton } from "~/components/marketing/TrackedPricingButton";
import { Button } from "~/components/ui/button";
import { SEARCH_CONFIG } from "~/lib/constants";
import { FREE_DAILY_SEARCH_LIMIT, PLANS } from "~/lib/plans";
import { api } from "~/trpc/server";

export const HOME_METADATA: Metadata = {
  title: "Search Salvage Yard Inventory Nationwide",
  description:
    "Search salvage yard inventory across LKQ, Row52, Pull-A-Part, and more. Find donor vehicles for parts, save searches, and get alerts when new matches arrive.",
  alternates: {
    canonical: "/",
  },
};

const numberFormatter = new Intl.NumberFormat("en-US");

function formatVehicleCount(count: number): string {
  return numberFormatter.format(count);
}

function formatYardCount(count: number): string {
  return numberFormatter.format(count);
}

export async function HomeLandingPage() {
  const liveStats = await api.stats.live();

  return (
    <div className="bg-background flex min-h-dvh flex-col">
      <Header />

      <main className="flex-1">
        {/* Hero */}
        <section className="flex min-h-[calc(100dvh-4rem)] flex-col px-5 pt-6 pb-8 sm:min-h-0 sm:px-6 sm:py-16 lg:px-8 lg:py-20">
          <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col sm:grid sm:max-w-6xl sm:flex-none sm:gap-12 lg:grid-cols-[1.2fr_0.8fr] lg:items-center">
            {/*
              Mobile layout: three rhythm zones distributed across the viewport.
              - Zone A (intro): pinned to top
              - Zone B (search): visually centered in the breathing space
              - Zone C (proof stats): pinned to the bottom, visually substantial
              `justify-between` with three direct children pushes the empty
              space *between* the zones rather than pooling it at the bottom.
              On `sm+` this collapses to a normal block stack so the existing
              desktop grid layout (text on the left, proof cards on the right)
              is preserved exactly.
            */}
            <div className="flex flex-1 flex-col justify-between gap-10 sm:block sm:flex-none">
              {/* Zone A — intro */}
              <div>
                <h1 className="max-w-3xl text-[2rem] leading-[1.1] font-bold tracking-tight text-balance sm:text-4xl md:text-5xl lg:text-6xl">
                  Search salvage yard inventory before the right donor vehicle
                  is gone.
                </h1>
                <p className="text-muted-foreground mt-5 max-w-2xl text-[1.0625rem] leading-relaxed text-pretty sm:mt-5 sm:text-lg md:text-xl">
                  Search across major yard networks in one place. See full
                  results with a free account, then upgrade to alerts when you
                  want new matches delivered automatically.
                </p>
              </div>

              {/* Zone B — primary action */}
              <div className="sm:mt-8">
                <HomeSearchHero />
              </div>

              {/* Zone C — proof, mobile only; bottom-anchored visual weight */}
              <div className="border-t pt-6 sm:hidden">
                <p className="text-muted-foreground mb-4 text-[0.6875rem] font-medium tracking-[0.1em] uppercase">
                  Live inventory
                </p>
                <div className="flex items-end justify-between gap-4 tabular-nums">
                  <div className="flex flex-col">
                    <span className="text-foreground text-[1.75rem] leading-none font-semibold tracking-tight">
                      {formatVehicleCount(liveStats.vehicleCount)}
                    </span>
                    <span className="text-muted-foreground mt-2 text-sm">
                      vehicles
                    </span>
                  </div>
                  <div className="bg-border h-10 w-px" aria-hidden="true" />
                  <div className="flex flex-col">
                    <span className="text-foreground text-[1.75rem] leading-none font-semibold tracking-tight">
                      {formatYardCount(liveStats.yardCount)}
                    </span>
                    <span className="text-muted-foreground mt-2 text-sm">
                      yards
                    </span>
                  </div>
                  <div className="bg-border h-10 w-px" aria-hidden="true" />
                  <div className="flex flex-col">
                    <span className="text-foreground text-[1.75rem] leading-none font-semibold tracking-tight">
                      Free
                    </span>
                    <span className="text-muted-foreground mt-2 text-sm">
                      to search
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Desktop/tablet proof cards */}
            <div className="hidden gap-4 sm:grid sm:grid-cols-2 lg:grid-cols-1">
              <ProofCard
                title={`${formatVehicleCount(liveStats.vehicleCount)} vehicles tracked`}
                description="Inventory from multiple salvage networks, updated into one searchable index."
              />
              <ProofCard
                title={`${formatYardCount(liveStats.yardCount)} yards nationwide`}
                description="Find donor vehicles near you or widen the search when the local yards come up empty."
              />
              <ProofCard
                title="Free search, paid tracking"
                description="Search anonymously, upgrade to Lite for filters and saved searches, and use Full when timing matters."
              />
            </div>
          </div>
        </section>

        {/* How it works */}
        <section className="border-t px-4 py-10 sm:px-6 sm:py-16 lg:px-8">
          <div className="mx-auto max-w-6xl">
            <div className="mb-6 max-w-2xl sm:mb-10">
              <p className="text-muted-foreground mb-2 text-sm font-medium">
                How it works
              </p>
              <h2 className="text-2xl font-semibold tracking-tight text-balance sm:text-3xl">
                Start free, pay only when tracking inventory for you becomes the
                valuable part.
              </h2>
            </div>

            <div className="grid gap-3 sm:gap-4 md:grid-cols-3">
              <ValueCard
                icon={<Search className="size-5" />}
                title="Search across networks"
                description="Run one search across LKQ, Row52, Pull-A-Part, AutoRecycler, and more instead of checking each site separately."
              />
              <ValueCard
                icon={<Car className="size-5" />}
                title="See the right donor vehicles"
                description="Filter by make, state, yard, color, and year to zero in on vehicles likely to have the part you need."
              />
              <ValueCard
                icon={<Bell className="size-5" />}
                title="Upgrade when timing matters"
                description={`Use the Full plan for $${PLANS.full.monthlyPrice}/mo to get email or Discord alerts when new matches arrive.`}
              />
            </div>
          </div>
        </section>

        {/* Pricing comparison */}
        <section className="border-t px-4 py-10 sm:px-6 sm:py-16 lg:px-8">
          <div className="mx-auto max-w-6xl">
            <div className="mb-6 max-w-2xl sm:mb-8">
              <p className="text-muted-foreground mb-2 text-sm font-medium">
                Free vs Paid
              </p>
              <h2 className="text-2xl font-semibold tracking-tight text-balance sm:text-3xl">
                Simple pricing for parts hunters who need speed, not enterprise
                plans.
              </h2>
            </div>

            <div className="grid gap-3 sm:gap-4 lg:grid-cols-2">
              <PlanCard
                eyebrow="Free account"
                title="Everyday searching"
                items={[
                  "Search salvage yard inventory for free",
                  `${SEARCH_CONFIG.ANONYMOUS_VISIBLE_RESULTS_LIMIT}-result preview before signing up, full results after`,
                  `${FREE_DAILY_SEARCH_LIMIT} searches per day`,
                  "No credit card required",
                ]}
                ctaHref="/auth/sign-up"
                ctaLabel="Create Free Account"
              />
              <PlanCard
                eyebrow="Lite & Full plans"
                title={`From $${PLANS.lite.monthlyPrice}/mo for filters and tracking`}
                items={[
                  `Lite ($${PLANS.lite.monthlyPrice}/mo): unlimited searches, advanced filters, saved searches`,
                  `Full ($${PLANS.full.monthlyPrice}/mo): everything in Lite plus email and Discord alerts`,
                  "Annual billing available for both plans",
                  "Best fit for repeat searches and fast-moving inventory",
                ]}
                ctaHref="/pricing"
                ctaLabel="See Pricing"
                trackPricing
                featured
              />
            </div>
          </div>
        </section>

        {/* Bottom CTA */}
        <section className="border-t px-4 py-10 sm:px-6 sm:py-16 lg:px-8">
          <div className="mx-auto max-w-3xl text-center">
            <h2 className="text-2xl font-semibold tracking-tight text-balance sm:text-3xl">
              Stop checking yard sites one by one.
            </h2>
            <p className="text-muted-foreground mt-3 text-base text-pretty sm:mt-4 sm:text-lg">
              Search free today. Create an account when you want continuity.
              Upgrade when you want the inventory tracked for you.
            </p>
            <div className="mt-6 flex flex-col items-center justify-center gap-3 sm:mt-8 sm:flex-row">
              <Button asChild size="lg">
                <Link href="/search">
                  Search Inventory
                  <ArrowRight className="size-4" />
                </Link>
              </Button>
              <TrackedPricingButton
                href="/pricing"
                label="Compare Plans"
                sourcePage="home"
                ctaLocation="bottom_compare_plans"
                variant="outline"
                size="lg"
              />
            </div>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}

function ProofCard({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-lg border p-5">
      <p className="text-lg font-semibold tracking-tight tabular-nums">
        {title}
      </p>
      <p className="text-muted-foreground mt-1.5 text-sm text-pretty">
        {description}
      </p>
    </div>
  );
}

function ValueCard({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="flex gap-3 rounded-lg border p-4 sm:block sm:p-6">
      <div className="bg-muted flex size-9 shrink-0 items-center justify-center rounded-md sm:mb-4 sm:size-10">
        {icon}
      </div>
      <div className="min-w-0">
        <h3 className="font-semibold">{title}</h3>
        <p className="text-muted-foreground mt-1 text-sm text-pretty sm:mt-2">
          {description}
        </p>
      </div>
    </div>
  );
}

function PlanCard({
  eyebrow,
  title,
  items,
  ctaHref,
  ctaLabel,
  trackPricing = false,
  featured = false,
}: {
  eyebrow: string;
  title: string;
  items: string[];
  ctaHref: string;
  ctaLabel: string;
  trackPricing?: boolean;
  featured?: boolean;
}) {
  return (
    <div
      className={`rounded-lg border p-4 sm:p-6 ${featured ? "border-primary bg-primary/5" : ""}`}
    >
      <p className="text-muted-foreground text-sm font-medium">{eyebrow}</p>
      <h3 className="mt-1.5 text-xl font-semibold tracking-tight text-balance sm:mt-2 sm:text-2xl">
        {title}
      </h3>
      <ul className="mt-4 space-y-2.5 text-sm sm:mt-6 sm:space-y-3">
        {items.map((item) => (
          <li key={item} className="flex gap-2">
            <span className="text-primary mt-0.5 inline-flex size-4 shrink-0 items-center justify-center">
              •
            </span>
            <span className="text-muted-foreground">{item}</span>
          </li>
        ))}
      </ul>
      {trackPricing ? (
        <TrackedPricingButton
          href={ctaHref}
          label={ctaLabel}
          sourcePage="home"
          ctaLocation="plan_card"
          variant={featured ? "default" : "outline"}
          className="mt-4 w-full sm:mt-6"
        />
      ) : (
        <Button
          asChild
          className="mt-4 w-full sm:mt-6"
          variant={featured ? "default" : "outline"}
        >
          <Link href={ctaHref}>{ctaLabel}</Link>
        </Button>
      )}
    </div>
  );
}
