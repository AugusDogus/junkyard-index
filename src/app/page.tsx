import { ArrowRight, Bell, Car, MapPin, Search, Zap } from "lucide-react";
import Link from "next/link";
import { Footer } from "~/components/Footer";
import { Button } from "~/components/ui/button";
import { api } from "~/trpc/server";

const numberFormatter = new Intl.NumberFormat("en-US");
const compactFormatter = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

function formatVehicleBadgeCount(count: number): string {
  if (count < 1000) {
    return `${numberFormatter.format(count)}+`;
  }

  return `${compactFormatter.format(count).toLowerCase()}+`;
}

function formatYardBadgeCount(count: number): string {
  if (count < 100) {
    return `${numberFormatter.format(count)}+`;
  }

  const roundedDownToNearestTen = Math.floor(count / 10) * 10;
  return `${numberFormatter.format(roundedDownToNearestTen)}+`;
}

export default async function Home() {
  const liveStats = await api.stats.live();

  const badgeText = `Tracking ${formatVehicleBadgeCount(liveStats.vehicleCount)} vehicles across ${formatYardBadgeCount(liveStats.yardCount)} yards`;

  return (
    <div className="flex min-h-dvh flex-col">
      {/* Hero Section */}
      <main className="flex flex-1 flex-col items-center justify-center px-4 py-16 text-center sm:px-6 lg:px-8">
        <div className="mx-auto max-w-3xl">
          {/* Badge */}
          <div className="bg-card/50 text-muted-foreground mb-8 inline-flex items-center gap-2 rounded-full border px-4 py-1.5 text-sm backdrop-blur-sm">
            <span className="relative flex size-2">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-green-400 opacity-75" />
              <span className="relative inline-flex size-2 rounded-full bg-green-500" />
            </span>
            {badgeText}
          </div>

          {/* Headline */}
          <h1 className="mb-6 text-4xl font-bold tracking-tight text-balance sm:text-5xl lg:text-6xl">
            Find your part.
            <br />
            <span className="from-primary to-primary/60 bg-gradient-to-r bg-clip-text text-transparent">
              Before it&apos;s gone.
            </span>
          </h1>

          {/* Subheadline */}
          <p className="text-muted-foreground mx-auto mb-10 max-w-lg text-lg text-pretty sm:text-xl">
            Search salvage yard inventory across the nation. Save searches, get
            alerts when new vehicles arrive, and never miss a part again.
          </p>

          {/* CTA */}
          <div className="flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
            <Button asChild size="lg" className="w-full sm:w-auto">
              <Link href="/search">
                <Search className="mr-2 size-4" />
                Start Searching
              </Link>
            </Button>
            <Button
              asChild
              variant="outline"
              size="lg"
              className="w-full sm:w-auto"
            >
              <Link href="/auth/sign-up">Create Free Account</Link>
            </Button>
          </div>
        </div>
      </main>

      {/* Features Section */}
      <section className="border-t px-4 py-24 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-5xl">
          <p className="text-muted-foreground mb-3 text-center text-sm font-medium">
            Why Junkyard Index
          </p>
          <h2 className="mb-4 text-center text-2xl font-semibold tracking-tight text-balance sm:text-3xl">
            Everything you need to find parts
          </h2>
          <p className="text-muted-foreground mx-auto mb-16 max-w-2xl text-center text-pretty">
            No more opening a dozen browser tabs. Search once across every major
            self-service yard network.
          </p>

          <div className="bg-border grid gap-px overflow-hidden rounded-xl border sm:grid-cols-2">
            <FeatureCard
              icon={<Search className="size-5" />}
              title="Unified Search"
              description="Search multiple salvage yards at once. No more checking each site individually."
            />
            <FeatureCard
              icon={<MapPin className="size-5" />}
              title="Distance Sorting"
              description="Find the closest vehicles to you. Enter your zip code and results sort by distance."
            />
            <FeatureCard
              icon={<Bell className="size-5" />}
              title="Email Alerts"
              description="Save a search and get notified the moment a matching vehicle arrives at any yard."
            />
            <FeatureCard
              icon={<Zap className="size-5" />}
              title="Real-Time Data"
              description="Inventory updates daily. See what's available right now, not last week."
            />
          </div>
        </div>
      </section>

      {/* How It Works Section */}
      <section className="border-t px-4 py-24 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-4xl">
          <p className="text-muted-foreground mb-3 text-center text-sm font-medium">
            How It Works
          </p>
          <h2 className="mb-16 text-center text-2xl font-semibold tracking-tight text-balance sm:text-3xl">
            Three steps to the part you need
          </h2>

          <div className="grid gap-12 sm:grid-cols-3 sm:gap-8">
            <StepCard
              step={1}
              title="Search"
              description="Enter a year, make, and model. We search every yard in our network instantly."
            />
            <StepCard
              step={2}
              title="Find"
              description="Browse results sorted by distance. See yard details, row numbers, and dates added."
            />
            <StepCard
              step={3}
              title="Save"
              description="Create an alert for your search. We email you when new matching vehicles arrive."
            />
          </div>
        </div>
      </section>

      {/* Data sources + live stats */}
      <section className="border-t px-4 py-24 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-4xl text-center">
          <h2 className="mb-4 text-2xl font-semibold tracking-tight text-balance sm:text-3xl">
            Four networks. One search.
          </h2>
          <p className="text-muted-foreground mx-auto mb-12 max-w-xl text-pretty">
            We pull inventory from each source daily and combine it into a
            single index—same filters, sorts, and alerts everywhere.
          </p>

          <div className="mb-16 flex flex-wrap items-center justify-center gap-x-10 gap-y-4">
            {[
              "LKQ Pick Your Part",
              "Pull-A-Part / U-Pull-&-Pay",
              "Row52",
              "AutoRecycler",
            ].map((name) => (
              <div key={name} className="flex items-center gap-2.5">
                <div className="bg-muted flex size-8 items-center justify-center rounded-md">
                  <Car className="text-muted-foreground size-4" />
                </div>
                <span className="text-sm font-medium">{name}</span>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-3 divide-x">
            <StatCard
              value={formatVehicleBadgeCount(liveStats.vehicleCount)}
              label="Vehicles Tracked"
            />
            <StatCard
              value={formatYardBadgeCount(liveStats.yardCount)}
              label="Yards Nationwide"
            />
            <StatCard value="4" label="Yard Networks" />
          </div>
        </div>
      </section>

      {/* Final CTA Section */}
      <section className="border-t px-4 py-24 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-xl text-center">
          <h2 className="mb-4 text-2xl font-semibold tracking-tight text-balance sm:text-3xl">
            Ready to find your part?
          </h2>
          <p className="text-muted-foreground mb-8 text-pretty">
            Stop checking multiple sites. Search once, find everything. Free to
            use, no credit card required.
          </p>
          <div className="flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
            <Button asChild size="lg" className="w-full sm:w-auto">
              <Link href="/search">
                <Search className="mr-2 size-4" />
                Search Inventory
              </Link>
            </Button>
            <Button
              asChild
              variant="outline"
              size="lg"
              className="w-full sm:w-auto"
            >
              <Link href="/auth/sign-up">
                Create Free Account
                <ArrowRight className="ml-2 size-4" />
              </Link>
            </Button>
          </div>
        </div>
      </section>

      <Footer />
    </div>
  );
}

function FeatureCard({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="bg-background flex flex-col gap-3 p-6 sm:p-8">
      <div className="bg-muted text-foreground flex size-10 items-center justify-center rounded-lg">
        {icon}
      </div>
      <h3 className="font-semibold">{title}</h3>
      <p className="text-muted-foreground text-sm text-pretty">{description}</p>
    </div>
  );
}

function StepCard({
  step,
  title,
  description,
}: {
  step: number;
  title: string;
  description: string;
}) {
  return (
    <div className="flex flex-col items-center text-center">
      <div className="border-foreground mb-4 flex size-10 items-center justify-center rounded-full border-2 text-sm font-semibold tabular-nums">
        {step}
      </div>
      <h3 className="mb-2 font-semibold">{title}</h3>
      <p className="text-muted-foreground text-sm text-pretty">{description}</p>
    </div>
  );
}

function StatCard({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex flex-col items-center gap-1 py-2">
      <p className="text-2xl font-bold tabular-nums sm:text-3xl">{value}</p>
      <p className="text-muted-foreground text-xs sm:text-sm">{label}</p>
    </div>
  );
}
