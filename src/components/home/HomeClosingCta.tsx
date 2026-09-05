import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { Button } from "~/components/ui/button";

export function HomeClosingCta() {
  return (
    <section
      aria-labelledby="home-cta-title"
      className="bg-muted/40 border-t px-4 py-16 sm:px-6 sm:py-24 lg:px-8"
    >
      <div className="mx-auto max-w-xl text-center">
        <h2
          id="home-cta-title"
          className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl"
        >
          Find your next donor vehicle.
        </h2>
        <p className="text-muted-foreground mt-4 text-base text-pretty">
          Search by year, make, model, or VIN across the yards we index.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Button asChild size="lg" className="rounded-lg">
            <Link href="/search">
              Search inventory <ArrowRight aria-hidden="true" />
            </Link>
          </Button>
          <Button asChild size="lg" variant="outline" className="rounded-lg">
            <Link href="/auth/sign-up">Create a free account</Link>
          </Button>
        </div>
      </div>
    </section>
  );
}
