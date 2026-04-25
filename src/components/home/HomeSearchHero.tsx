"use client";

import { ArrowRight, Search } from "lucide-react";
import Link from "next/link";
import posthog from "posthog-js";
import { useState } from "react";
import { Button } from "~/components/ui/button";
import { AnalyticsEvents } from "~/lib/analytics-events";

const SAMPLE_QUERIES = ["Honda Civic", "Toyota Camry", "Ford F-150"];

export function HomeSearchHero() {
  const [query, setQuery] = useState("");

  const buildSearchHref = (value: string) => {
    const trimmed = value.trim();
    return trimmed ? `/search?q=${encodeURIComponent(trimmed)}` : "/search";
  };

  const trackSearch = (value: string, source: "typed" | "sample") => {
    const trimmed = value.trim();
    if (!trimmed) return;

    posthog.capture(AnalyticsEvents.LANDING_SEARCH_SUBMITTED, {
      source_page: "home",
      query: trimmed,
      query_length: trimmed.length,
      submit_source: source,
    });
  };

  const searchHref = buildSearchHref(query);

  return (
    <div className="w-full max-w-3xl">
      <form
        onSubmit={(event) => {
          if (!query.trim()) {
            event.preventDefault();
            return;
          }
          trackSearch(query, "typed");
        }}
        action="/search"
        className="space-y-3"
      >
        <div className="relative">
          <label htmlFor="home-search" className="sr-only">
            Search salvage yard inventory
          </label>
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2" />
          <input
            id="home-search"
            name="q"
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search year, make, or model"
            className="file:text-foreground placeholder:text-muted-foreground selection:bg-primary selection:text-primary-foreground dark:bg-input/30 border-input focus-visible:border-ring focus-visible:ring-ring/50 bg-background h-11 w-full rounded-lg border py-2 pr-11 pl-10 text-base shadow-sm outline-none focus-visible:ring-[3px] sm:h-12 sm:pr-12 sm:pl-11 sm:text-lg"
          />
          <Link
            href={searchHref}
            onClick={(event) => {
              if (!query.trim()) {
                event.preventDefault();
                return;
              }
              trackSearch(query, "typed");
            }}
            className="text-muted-foreground hover:text-foreground hover:bg-accent absolute top-1/2 right-1.5 flex size-8 -translate-y-1/2 items-center justify-center rounded-md transition-colors duration-150 ease-out active:scale-[0.95] sm:size-9"
            aria-label="Search"
          >
            <ArrowRight className="size-4" />
          </Link>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 text-sm sm:gap-2">
          <span className="text-muted-foreground">Try:</span>
          {SAMPLE_QUERIES.map((sample) => (
            <Link
              key={sample}
              href={buildSearchHref(sample)}
              onClick={() => trackSearch(sample, "sample")}
              className="bg-muted hover:bg-muted/80 rounded-md px-3 py-1.5 font-medium transition-colors duration-150 ease-out active:scale-[0.97]"
            >
              {sample}
            </Link>
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
