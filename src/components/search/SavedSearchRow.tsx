"use client";

import Link from "next/link";
import { ArrowRight, Search } from "lucide-react";
import "./saved-search-row.css";
import { SavedSearchQuickAlerts } from "~/components/search/SavedSearchQuickAlerts";
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
  const content = (
    <>
      <span className="saved-search-row-icon">
        <Search size={19} aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <h3 className="text-base font-semibold break-words">{search.name}</h3>
        <p
          className="text-muted-foreground mt-2 line-clamp-3 text-sm leading-relaxed break-words"
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
      {!locked && (
        <ArrowRight
          className="saved-search-row-arrow"
          size={16}
          aria-hidden="true"
        />
      )}
    </>
  );
  return (
    <article aria-label={search.name} className="saved-search-row">
      {locked ? (
        <div className="saved-search-row-main">{content}</div>
      ) : (
        <Link
          href={buildSearchUrl(search.query, search.filters)}
          aria-label={`Open saved search ${search.name}`}
          className="saved-search-row-main"
        >
          {content}
        </Link>
      )}
      <div className="saved-search-row-actions">
        {!locked && <SavedSearchQuickAlerts search={search} source={source} />}
        <EditSavedSearchLink search={search} source={source} />
      </div>
    </article>
  );
}
