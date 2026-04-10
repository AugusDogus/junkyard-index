import { ArrowRight, Bell, Car, Search } from "lucide-react";
import { type Metadata } from "next";
import Link from "next/link";
import { Footer } from "~/components/Footer";
import { Header } from "~/components/Header";
import { HomeSearchHero } from "~/components/home/HomeSearchHero";
import { TrackedPricingButton } from "~/components/marketing/TrackedPricingButton";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { MONETIZATION_CONFIG } from "~/lib/constants";
import { api } from "~/trpc/server";

export const metadata: Metadata = {
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

export default async function Home() {
  const liveStats = await api.stats.live();

  return (
    <div className="bg-background flex min-h-dvh flex-col">
      <Header />

      <main className="flex-1">
        {/* Hero */}
        <section className="px-4 py-10 sm:px-6 sm:py-16 lg:px-8 lg:py-20">
          <div className="mx-auto grid max-w-6xl gap-8 sm:gap-12 lg:grid-cols-[1.2fr_0.8fr] lg:items-center">
            <div>
              <Badge variant="outline" className="mb-4 gap-2 px-3 py-1 sm:mb-5">
                <span className="inline-flex size-2 rounded-full bg-green-500" />
                Search is free. Alerts are $
                {MONETIZATION_CONFIG.ALERTS_PLAN_PRICE_MONTHLY}/mo.
              </Badge>
              <h1 className="max-w-3xl text-3xl font-bold tracking-tight text-balance sm:text-4xl md:text-5xl lg:text-6xl">
                Search salvage yard inventory before the right donor vehicle is
                gone.
              </h1>
              <p className="text-muted-foreground mt-4 max-w-2xl text-base text-pretty sm:mt-5 sm:text-lg md:text-xl">
                Search across major yard networks in one place. See full results
                with a free account, then upgrade to alerts when you want new
                matches delivered automatically.
              </p>

              <div className="mt-6 sm:mt-8">
                <HomeSearchHero />
              </div>

              {/* Mobile proof stats — compact inline row */}
              <div className="text-muted-foreground mt-5 flex flex-wrap gap-x-4 gap-y-1 text-sm tabular-nums sm:hidden">
                <p>
                  <span className="text-foreground font-medium">
                    {formatVehicleCount(liveStats.vehicleCount)}
                  </span>{" "}
                  vehicles
                </p>
                <p>
                  <span className="text-foreground font-medium">
                    {formatYardCount(liveStats.yardCount)}
                  </span>{" "}
                  yards
                </p>
                <p>Free to search</p>
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
                description="Search anonymously, create a free account to save work, and use Alerts Plan when timing matters."
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
                description={`Use Alerts Plan for $${MONETIZATION_CONFIG.ALERTS_PLAN_PRICE_MONTHLY}/mo to get email or Discord alerts when new matches arrive.`}
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
                title="Full results and saved searches"
                items={[
                  "Search salvage yard inventory for free",
                  "See full results after creating a free account",
                  `Create up to ${MONETIZATION_CONFIG.FREE_SAVED_SEARCH_LIMIT} saved searches`,
                  "No credit card required",
                ]}
                ctaHref="/auth/sign-up"
                ctaLabel="Create Free Account"
              />
              <PlanCard
                eyebrow="Alerts Plan"
                title={`$${MONETIZATION_CONFIG.ALERTS_PLAN_PRICE_MONTHLY}/mo for inventory tracking`}
                items={[
                  "Unlimited saved searches",
                  "Email alerts for new matches",
                  "Discord alerts for new matches",
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
                label="Compare Free and Alerts Plan"
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
