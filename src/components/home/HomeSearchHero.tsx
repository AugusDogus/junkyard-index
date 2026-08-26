"use client";

import { ArrowRight, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import posthog from "posthog-js";
import { useState } from "react";
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
        className="space-y-4 sm:space-y-3"
      >
        <div className="relative">
          <label htmlFor="home-search" className="sr-only">
            Search salvage yard inventory
          </label>
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-4 size-[1.125rem] -translate-y-1/2 sm:left-3.5 sm:size-4" />
          <input
            id="home-search"
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search year, make, or model"
            className="file:text-foreground placeholder:text-muted-foreground selection:bg-primary selection:text-primary-foreground dark:bg-input/30 border-input focus-visible:border-ring focus-visible:ring-ring/50 bg-background h-13 w-full rounded-xl border py-2 pr-12 pl-11 text-base shadow-sm outline-none focus-visible:ring-[3px] sm:h-12 sm:rounded-lg sm:pr-12 sm:pl-11 sm:text-lg"
          />
          <button
            type="submit"
            className="text-muted-foreground hover:text-foreground hover:bg-accent absolute top-1/2 right-1.5 flex size-10 -translate-y-1/2 items-center justify-center rounded-lg transition-colors duration-150 ease-out active:scale-[0.95] sm:size-9 sm:rounded-md"
            aria-label="Search"
          >
            <ArrowRight className="size-[1.125rem] sm:size-4" />
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-sm sm:gap-2">
          <span className="text-muted-foreground mr-0.5">Try:</span>
          {SAMPLE_QUERIES.map((sample) => (
            <button
              key={sample}
              type="button"
              onClick={() => submitSearch(sample, "sample")}
              className="bg-muted hover:bg-muted/80 rounded-md px-3 py-2 font-medium transition-colors duration-150 ease-out active:scale-[0.97] sm:py-1.5"
            >
              {sample}
            </button>
          ))}
        </div>
      </form>
    </div>
  );
}
