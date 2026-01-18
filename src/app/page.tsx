import { Bell, MapPin, Search, Zap } from "lucide-react";
import Link from "next/link";
import { Footer } from "~/components/Footer";
import { Button } from "~/components/ui/button";

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col bg-gradient-to-b from-background via-background to-muted/30">
      {/* Hero Section */}
      <main className="flex flex-1 flex-col items-center justify-center px-4 py-16 text-center sm:px-6 lg:px-8">
        <div className="mx-auto max-w-3xl">
          {/* Badge */}
          <div className="mb-8 inline-flex items-center gap-2 rounded-full border bg-card/50 px-4 py-1.5 text-sm text-muted-foreground backdrop-blur-sm">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-green-500" />
            </span>
            Tracking 100k+ vehicles across 300+ yards
          </div>

          {/* Headline */}
          <h1 className="mb-6 text-4xl font-bold tracking-tight sm:text-5xl lg:text-6xl">
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
                <Search className="mr-2 h-4 w-4" />
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
      <section className="border-t bg-card/30 px-4 py-20 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-5xl">
          <h2 className="mb-12 text-center text-2xl font-semibold tracking-tight sm:text-3xl">
            Everything you need to find parts
          </h2>

          <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
            <FeatureCard
              icon={<Search className="h-5 w-5" />}
              title="Unified Search"
              description="Search multiple salvage yards at once. No more checking each site individually."
            />
            <FeatureCard
              icon={<MapPin className="h-5 w-5" />}
              title="Distance Sorting"
              description="Find the closest vehicles to your location. Enter your zip code and sort by distance."
            />
            <FeatureCard
              icon={<Bell className="h-5 w-5" />}
              title="Email Alerts"
              description="Save searches and get notified when matching vehicles arrive at any yard."
            />
            <FeatureCard
              icon={<Zap className="h-5 w-5" />}
              title="Real-Time Data"
              description="Inventory updates daily. See what's available right now, not last week."
            />
          </div>
        </div>
      </section>

      {/* Data Sources Section */}
      <section className="px-4 py-16 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-3xl text-center">
          <p className="mb-6 text-sm font-medium uppercase tracking-wider text-muted-foreground">
            Aggregating inventory from
          </p>
          <div className="flex flex-wrap items-center justify-center gap-8 text-xl font-semibold text-muted-foreground/80">
            <span>LKQ Pick Your Part</span>
            <span className="hidden text-border sm:inline">•</span>
            <span>Row52</span>
          </div>
        </div>
      </section>

      {/* Final CTA Section */}
      <section className="border-t bg-gradient-to-t from-muted/50 to-transparent px-4 py-20 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="mb-4 text-2xl font-semibold tracking-tight sm:text-3xl">
            Ready to find your part?
          </h2>
          <p className="mb-8 text-muted-foreground">
            Stop checking multiple sites. Search once, find everything.
          </p>
          <Button asChild size="lg">
            <Link href="/search">
              <Search className="mr-2 h-4 w-4" />
              Search Inventory
            </Link>
          </Button>
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
    <div className="group rounded-xl border bg-card/50 p-6 transition-colors hover:bg-card">
      <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
        {icon}
      </div>
      <h3 className="mb-2 font-semibold">{title}</h3>
      <p className="text-sm text-muted-foreground">{description}</p>
    </div>
  );
}
