"use client";

import { useRouter } from "next/navigation";
import posthog from "posthog-js";
import { useState } from "react";
import { SearchField } from "~/components/search/SearchField";
import { AnalyticsEvents } from "~/lib/analytics-events";

export function HomeSearchHero() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const submitSearch = (value: string) => {
    const trimmed = value.trim();
    posthog.capture(AnalyticsEvents.LANDING_SEARCH_SUBMITTED, {
      source_page: "home",
      query: trimmed,
      query_length: trimmed.length,
      submit_source: "typed",
    });
    router.push(
      trimmed ? `/search?q=${encodeURIComponent(trimmed)}` : "/search",
    );
  };

  return (
    <div className="w-full min-w-0 py-3">
      <form
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          submitSearch(query);
        }}
      >
        <label htmlFor="home-search" className="sr-only">
          Search by year, make, model, or VIN
        </label>
        <SearchField
          id="home-search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </form>
    </div>
  );
}
