"use client";

import { ArrowRight, Search } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import posthog from "posthog-js";
import { useState } from "react";
import { Button } from "~/components/ui/button";
import { AnalyticsEvents } from "~/lib/analytics-events";

const SAMPLE_QUERIES = ["Honda Civic", "Toyota Camry", "Ford F-150"];

export function HomeSearchHero() {
  const router = useRouter();
  const [query, setQuery] = useState("");

  const submitSearch = (value: string, source: "typed" | "sample") => {
    const trimmed = value.trim();
    if (!trimmed) return;

    posthog.capture(AnalyticsEvents.LANDING_SEARCH_SUBMITTED, {
      source_page: "home",
      query: trimmed,
      query_length: trimmed.length,
      submit_source: source,
    });

    router.push(`/search?q=${encodeURIComponent(trimmed)}`);
  };

  return (
    <div className="w-full max-w-3xl">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          submitSearch(query, "typed");
        }}
        className="space-y-4"
      >
        <div className="relative">
          <label htmlFor="home-search" className="sr-only">
            Search salvage yard inventory
          </label>
          <input
            id="home-search"
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search year, make, or model"
            className="file:text-foreground placeholder:text-muted-foreground selection:bg-primary selection:text-primary-foreground dark:bg-input/30 border-input focus-visible:border-ring focus-visible:ring-ring/50 bg-background h-12 w-full rounded-md border px-4 pr-14 text-base shadow-sm outline-none focus-visible:ring-[3px] sm:pr-34"
          />
          <Button
            type="submit"
            size="lg"
            className="absolute top-1 right-1 h-10 px-3 sm:px-4"
            aria-label="Search"
          >
            <Search className="size-4" />
            <span className="hidden sm:inline">Search Free</span>
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted-foreground">Try:</span>
          {SAMPLE_QUERIES.map((sample) => (
            <button
              key={sample}
              type="button"
              onClick={() => submitSearch(sample, "sample")}
              className="bg-muted hover:bg-muted/80 rounded-md px-3 py-1.5 font-medium transition-colors"
            >
              {sample}
            </button>
          ))}
        </div>
      </form>

      <div className="mt-6 hidden gap-3 sm:flex sm:flex-row">
        <Button asChild variant="outline" size="lg">
          <Link href="/auth/sign-up">Create Free Account</Link>
        </Button>
        <Button asChild variant="ghost" size="lg">
          <Link
            href="/pricing"
            onClick={() =>
              posthog.capture(AnalyticsEvents.PRICING_CTA_CLICKED, {
                source_page: "home",
                cta_location: "hero",
                is_logged_in: false,
              })
            }
          >
            See Pricing
            <ArrowRight className="size-4" />
          </Link>
        </Button>
      </div>
    </div>
  );
}
