"use client";

import Link from "next/link";
import { EditSavedSearchLink } from "~/components/search/EditSavedSearchLink";
import { INGESTION_SOURCE_DISPLAY_NAMES } from "~/lib/ingestion-source";
import { buildSearchUrl } from "~/lib/search-utils";
import type { RouterOutputs } from "~/trpc/react";

type SavedSearch = RouterOutputs["savedSearches"]["list"][number];

function criteriaPreview(search: SavedSearch): string {
  const { filters } = search;
  const details = [filters.expression, search.query.trim(), filters.vinPattern];
  if (filters.minYear && filters.maxYear)
    details.push(`${filters.minYear}–${filters.maxYear}`);
  else if (filters.minYear) details.push(`${filters.minYear} or newer`);
  else if (filters.maxYear) details.push(`${filters.maxYear} or older`);
  for (const values of [
    filters.makes,
    filters.colors,
    filters.states,
    filters.salvageYards,
  ]) {
    if (values?.length) details.push(values.join(", "));
  }
  if (filters.sources?.length)
    details.push(
      filters.sources
        .map((source) => INGESTION_SOURCE_DISPLAY_NAMES[source])
        .join(", "),
    );
  return details.filter(Boolean).join("; ") || "All vehicles";
}

export function SavedSearchRow({
  search,
  locked,
  source,
}: {
  search: SavedSearch;
  locked: boolean;
  source: "settings" | "saved_searches_list";
}) {
  const preview = criteriaPreview(search);
  return (
    <article
      aria-label={search.name}
      className="flex min-w-0 items-start gap-3 py-4"
    >
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-start gap-1">
          <h3 className="min-w-0 text-base font-semibold text-balance break-words">
            {locked ? (
              search.name
            ) : (
              <Link
                href={buildSearchUrl(search.query, search.filters)}
                aria-label={`Open saved search ${search.name}`}
                className="focus-visible:ring-ring flex min-h-11 items-center rounded-sm underline-offset-4 outline-none hover:underline focus-visible:ring-2 sm:min-h-8"
              >
                {search.name}
              </Link>
            )}
          </h3>
          {!locked && (
            <EditSavedSearchLink
              search={search}
              source={source}
              trigger="alerts"
            />
          )}
        </div>
        <p
          className="text-muted-foreground mt-1 line-clamp-2 text-sm break-words"
          title={preview}
        >
          {preview}
        </p>
        {locked && (
          <p className="text-muted-foreground mt-2 text-xs">
            Upgrade to reopen this search
          </p>
        )}
      </div>
      <EditSavedSearchLink search={search} source={source} />
    </article>
  );
}
