import { type Metadata } from "next";
import { Footer } from "~/components/Footer";
import { TrackedPricingButton } from "~/components/marketing/TrackedPricingButton";
import { StaticHeader } from "~/components/StaticHeader";
import { MONETIZATION_CONFIG } from "~/lib/constants";

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "Compare Free Search and Alerts Plan. Search salvage yard inventory for free, then upgrade to alerts for $3/mo when you need ongoing inventory tracking.",
  alternates: {
    canonical: "/pricing",
  },
};

export default function PricingPage() {
  return (
    <div className="bg-background flex min-h-dvh flex-col">
      <StaticHeader />

        <main className="flex-1 px-4 py-16 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-5xl">
          <div className="mx-auto max-w-2xl text-center">
            <p className="text-muted-foreground text-sm font-medium">
              Pricing
            </p>
            <h1 className="mt-3 text-4xl font-bold tracking-tight text-balance sm:text-5xl">
              Search free. Upgrade when you want inventory tracked for you.
            </h1>
            <p className="text-muted-foreground mt-4 text-lg text-pretty">
              The free account is for exploring inventory and saving work. The
              Alerts Plan is for repeat searches that need email or Discord
              notifications when new matching vehicles arrive.
            </p>
          </div>

          <div className="mt-12 grid gap-4 lg:grid-cols-2">
            <PricingCard
              eyebrow="Free Search"
              title="$0"
              description="Best for one-off searches and casual inventory checks."
              items={[
                "Search salvage yard inventory",
                "See full search results after creating a free account",
                `Up to ${MONETIZATION_CONFIG.FREE_SAVED_SEARCH_LIMIT} saved searches`,
                "No credit card required",
              ]}
              ctaHref="/auth/sign-up"
              ctaLabel="Create Free Account"
              ctaLocation="free_plan"
            />
            <PricingCard
              eyebrow="Alerts Plan"
              title={`$${MONETIZATION_CONFIG.ALERTS_PLAN_PRICE_MONTHLY}/mo`}
              description="Best for repeat parts hunters, rebuilders, and ongoing searches."
              items={[
                "Unlimited saved searches",
                "Email alerts when new matches arrive",
                "Discord alerts when new matches arrive",
                "Faster follow-up on hard-to-find donor vehicles",
              ]}
              ctaHref="/search"
              ctaLabel="Search Inventory"
              ctaLocation="alerts_plan"
              featured
            />
          </div>

          <div className="mt-12 rounded-lg border p-6 text-center">
            <h2 className="text-2xl font-semibold tracking-tight">
              What changes when you upgrade?
            </h2>
            <p className="text-muted-foreground mx-auto mt-3 max-w-2xl text-pretty">
              Search stays simple. The paid value is continuity: more saved
              searches, email alerts, and Discord alerts when inventory changes
              after you leave.
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

function PricingCard({
  eyebrow,
  title,
  description,
  items,
  ctaHref,
  ctaLabel,
  ctaLocation,
  featured = false,
}: {
  eyebrow: string;
  title: string;
  description: string;
  items: string[];
  ctaHref: string;
  ctaLabel: string;
  ctaLocation: string;
  featured?: boolean;
}) {
  return (
    <div
      className={`rounded-lg border p-6 ${featured ? "border-primary bg-primary/5" : ""}`}
    >
      <p className="text-muted-foreground text-sm font-medium">{eyebrow}</p>
      <h2 className="mt-2 text-3xl font-semibold tracking-tight">{title}</h2>
      <p className="text-muted-foreground mt-3 text-sm text-pretty">
        {description}
      </p>
      <ul className="mt-6 space-y-3 text-sm">
        {items.map((item) => (
          <li key={item} className="flex gap-2">
            <span className="text-primary mt-0.5 inline-flex size-4 shrink-0 items-center justify-center">
              •
            </span>
            <span className="text-muted-foreground">{item}</span>
          </li>
        ))}
      </ul>
      <TrackedPricingButton
        href={ctaHref}
        label={ctaLabel}
        sourcePage="pricing"
        ctaLocation={ctaLocation}
        variant={featured ? "default" : "outline"}
        className="mt-6 w-full"
      />
    </div>
  );
}
