import Link from "next/link";
import { Button } from "~/components/ui/button";

/** The close: the head beside its two actions, on the quiet second surface. */
export function HomeClosingCta() {
  return (
    <section
      aria-labelledby="home-cta-title"
      className="bg-paper-2 text-ink border-rule border-t"
    >
      <div className="shell grid gap-8 py-20 sm:py-28 lg:grid-cols-12 lg:items-end lg:gap-8">
        <h2
          id="home-cta-title"
          className="text-display-s leading-[1.02] font-medium lg:col-span-7"
        >
          Find your next donor vehicle.
        </h2>
        <div className="lg:col-span-5">
          <p className="text-lead text-ink-2 text-pretty">
            Search by year, make, model, or VIN across the yards we index.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Button asChild size="xl">
              <Link href="/search">Search inventory</Link>
            </Button>
            <Button asChild size="xl" variant="outline">
              <Link href="/auth/sign-up">Create a free account</Link>
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
