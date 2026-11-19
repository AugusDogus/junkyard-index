"use client";

import Link from "next/link";
import {
  LOCATION_PREFERENCE_STORAGE_KEY,
  parseStoredLocationPreference,
  hasFiniteCoordinates,
} from "~/lib/location-preferences";
import { buildSearchUrl } from "~/lib/search-utils";
import { useRouter } from "next/navigation";
import { Analytics } from "~/lib/analytics";
import { useState } from "react";
import { SearchField } from "~/components/search/SearchField";
import { AnalyticsEvents } from "~/lib/analytics-events";

export function HomeSearchHero() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const submitSearch = (value: string) => {
    const trimmed = value.trim();
    Analytics.capture(AnalyticsEvents.LANDING_SEARCH_SUBMITTED, {
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
    <div className="w-full min-w-0">
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
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1">
        <Link
          href="/search?arrivalWindow%5B%5D=7d&radius=50"
          onClick={(event) => {
            if (
              event.metaKey ||
              event.ctrlKey ||
              event.shiftKey ||
              event.altKey
            )
              return;
            try {
              const preference = parseStoredLocationPreference(
                JSON.parse(
                  window.localStorage.getItem(
                    LOCATION_PREFERENCE_STORAGE_KEY,
                  ) ?? "null",
                ),
              );
              if (
                preference?.mode !== "zip" ||
                !hasFiniteCoordinates(preference)
              )
                return;
              event.preventDefault();
              router.push(
                buildSearchUrl("", {
                  arrivalWindow: "7d",
                  yardTypes: ["self_service"],
                  near: {
                    lat: preference.lat,
                    lng: preference.lng,
                    radiusMiles: 50,
                  },
                }),
              );
            } catch {
              // An unreadable preference leaves the ZIP chooser available in search.
            }
          }}
          className="text-signal inline-flex min-h-11 items-center font-bold underline underline-offset-4"
        >
          New near me
        </Link>
        <span className="text-ink-2 text-sm text-pretty">
          This week’s arrivals within 50 miles. Choose a ZIP or use your saved
          location.
        </span>
      </div>
    </div>
  );
}
