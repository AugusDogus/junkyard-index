"use client";

import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { EditSavedSearchDialog } from "~/components/settings/EditSavedSearchDialog";
import { INGESTION_SOURCE_DISPLAY_NAMES } from "~/lib/ingestion-source";
import { buildSearchUrl } from "~/lib/search-utils";
import type { RouterOutputs } from "~/trpc/react";

type SavedSearch = RouterOutputs["savedSearches"]["list"][number];

function criteriaPreview(search: SavedSearch): string {
  const { filters } = search;
  const details = [search.query.trim(), filters.vinPattern];
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
  const channels = [
    search.emailAlertsEnabled ? "Email" : null,
    search.discordAlertsEnabled ? "Discord" : null,
  ].filter(Boolean);
  const preview = criteriaPreview(search);
  const summary = (
    <>
      <h3 className="flex items-center gap-2 text-base font-semibold text-balance break-words">
        <span className="min-w-0">{search.name}</span>
        {!locked && (
          <ChevronRight
            aria-hidden="true"
            className="text-muted-foreground size-4 shrink-0"
          />
        )}
      </h3>
      <p
        className="text-muted-foreground mt-1 line-clamp-2 text-sm break-words"
        title={preview}
      >
        {preview}
      </p>
    </>
  );
  return (
    <article
      aria-label={search.name}
      className="flex min-w-0 items-start gap-4 py-5"
    >
      <div className="min-w-0 flex-1">
        {locked ? (
          <div>{summary}</div>
        ) : (
          <Link
            href={buildSearchUrl(search.query, search.filters)}
            aria-label={`Open saved search ${search.name}`}
            className="focus-visible:ring-ring block min-h-11 rounded-sm py-1 underline-offset-4 outline-none focus-visible:ring-2 hover:[&_h3]:underline"
          >
            {summary}
          </Link>
        )}
        <p className="text-muted-foreground mt-2 text-xs">
          {locked
            ? "Upgrade to reopen this search"
            : channels.length
              ? `Alerts: ${channels.join(" + ")}`
              : "Alerts off"}
        </p>
      </div>
      <EditSavedSearchDialog search={search} source={source} locked={locked} />
    </article>
  );
}
