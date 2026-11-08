import Link from "next/link";
import { Button } from "~/components/ui/button";

/** The close, on Wayfind's one cobalt field: the head beside its two actions. */
export function HomeClosingCta() {
  return (
    <section
      aria-labelledby="home-cta-title"
      className="bg-signal-fill text-signal-ink border-ink border-t-2"
    >
      <div className="shell grid gap-8 py-20 sm:py-28 lg:grid-cols-12 lg:items-end lg:gap-8">
        <h2
          id="home-cta-title"
          className="text-display-s leading-[1.02] font-extrabold lg:col-span-7"
        >
          Find your next donor vehicle.
        </h2>
        <div className="lg:col-span-5">
          <p className="text-lead text-pretty">
            Search by year, make, model, or VIN across the yards we index.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Button
              asChild
              size="xl"
              className="border-ink bg-ink text-paper hover:border-signal-ink hover:bg-signal-ink hover:text-ink focus-visible:outline-signal-ink"
            >
              <Link href="/search">Search inventory</Link>
            </Button>
            <Button
              asChild
              size="xl"
              variant="outline"
              className="border-signal-ink text-signal-ink hover:bg-signal-ink hover:text-signal-fill focus-visible:outline-signal-ink"
            >
              <Link href="/auth/sign-up">Create a free account</Link>
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
