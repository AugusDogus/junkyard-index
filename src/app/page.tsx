import {
    ArrowRight,
    Bell,
    Car,
    MapPin,
    Search,
    Zap,
} from "lucide-react";
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
          <div className="mb-8 inline-flex items-center gap-2 rounded-full border bg-card/50 px-4 py-1.5 text-sm text-muted-foreground backdrop-blur-sm">
            <span className="relative flex size-2">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-green-400 opacity-75" />
              <span className="relative inline-flex size-2 rounded-full bg-green-500" />
            </span>
            {badgeText}
          </div>

          {/* Headline */}
          <h1 className="mb-6 text-balance text-4xl font-bold tracking-tight sm:text-5xl lg:text-6xl">
            Find your part.
            <br />
            <span className="bg-gradient-to-r from-primary to-primary/60 bg-clip-text text-transparent">
              Before it&apos;s gone.
            </span>
          </h1>

          {/* Subheadline */}
          <p className="mx-auto mb-10 max-w-lg text-lg text-muted-foreground sm:text-xl text-pretty">
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
          <p className="mb-3 text-center text-sm font-medium text-muted-foreground">
            Why Junkyard Index
          </p>
          <h2 className="mb-4 text-balance text-center text-2xl font-semibold tracking-tight sm:text-3xl">
            Everything you need to find parts
          </h2>
          <p className="mx-auto mb-16 max-w-2xl text-center text-muted-foreground text-pretty">
            No more opening a dozen browser tabs. Search once across every
            major self-service yard network.
          </p>

          <div className="grid gap-px overflow-hidden rounded-xl border bg-border sm:grid-cols-2">
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
          <p className="mb-3 text-center text-sm font-medium text-muted-foreground">
            How It Works
          </p>
          <h2 className="mb-16 text-balance text-center text-2xl font-semibold tracking-tight sm:text-3xl">
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

      {/* Stats Section */}
      <section className="border-t px-4 py-24 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-4xl">
          <div className="grid gap-px overflow-hidden rounded-xl border bg-border sm:grid-cols-3">
            <StatCard
              value={formatVehicleBadgeCount(liveStats.vehicleCount)}
              label="Vehicles Tracked"
            />
            <StatCard
              value={formatYardBadgeCount(liveStats.yardCount)}
              label="Yards Nationwide"
            />
            <StatCard value="2" label="Yard Networks" />
          </div>
        </div>
      </section>

      {/* Data Sources Section */}
      <section className="border-t px-4 py-24 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-3xl">
          <p className="mb-3 text-center text-sm font-medium text-muted-foreground">
            Data Sources
          </p>
          <h2 className="mb-12 text-balance text-center text-2xl font-semibold tracking-tight sm:text-3xl">
            Aggregating inventory you can trust
          </h2>
          <div className="grid gap-px overflow-hidden rounded-xl border bg-border sm:grid-cols-2">
            <div className="flex flex-col items-center gap-3 bg-background p-8 text-center">
              <div className="flex size-10 items-center justify-center rounded-lg bg-muted">
                <Car className="size-5 text-muted-foreground" />
              </div>
              <p className="text-lg font-semibold">LKQ Pick Your Part</p>
              <p className="text-sm text-muted-foreground text-pretty">
                The largest self-service used auto parts network in the US.
              </p>
            </div>
            <div className="flex flex-col items-center gap-3 bg-background p-8 text-center">
              <div className="flex size-10 items-center justify-center rounded-lg bg-muted">
                <Car className="size-5 text-muted-foreground" />
              </div>
              <p className="text-lg font-semibold">Row52</p>
              <p className="text-sm text-muted-foreground text-pretty">
                Community-powered inventory from independent yards across the
                country.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Final CTA Section */}
      <section className="border-t px-4 py-24 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-xl text-center">
          <h2 className="mb-4 text-balance text-2xl font-semibold tracking-tight sm:text-3xl">
            Ready to find your part?
          </h2>
          <p className="mb-8 text-muted-foreground text-pretty">
            Stop checking multiple sites. Search once, find everything.
            Free to use, no credit card required.
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
    <div className="flex flex-col gap-3 bg-background p-6 sm:p-8">
      <div className="flex size-10 items-center justify-center rounded-lg bg-muted text-foreground">
        {icon}
      </div>
      <h3 className="font-semibold">{title}</h3>
      <p className="text-sm text-muted-foreground text-pretty">{description}</p>
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
      <div className="mb-4 flex size-10 items-center justify-center rounded-full border-2 border-foreground text-sm font-semibold tabular-nums">
        {step}
      </div>
      <h3 className="mb-2 font-semibold">{title}</h3>
      <p className="text-sm text-muted-foreground text-pretty">{description}</p>
    </div>
  );
}

function StatCard({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex flex-col items-center gap-1 bg-background p-8">
      <p className="text-3xl font-bold tabular-nums sm:text-4xl">{value}</p>
      <p className="text-sm text-muted-foreground">{label}</p>
    </div>
  );
}
