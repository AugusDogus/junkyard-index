import { SEARCH_SORT_OPTIONS } from "~/components/search/search-routing";
import { INGESTION_SOURCE_DISPLAY_NAMES } from "~/lib/ingestion-source";
import type { SavedSearchFilters } from "~/lib/saved-search-filters";
import { getAdvancedSearchQueryFields } from "~/lib/advanced-search-query";

interface SavedSearchCriterion {
  label: string;
  value: string;
}

function getSavedSearchCriteria(
  query: string,
  filters: SavedSearchFilters,
): SavedSearchCriterion[] {
  const criteria: SavedSearchCriterion[] = [];
  if (filters.expression !== undefined)
    criteria.push({
      label: "Expression",
      value: filters.expression || "All vehicles",
    });
  if (query.trim()) {
    const fields = getAdvancedSearchQueryFields(query);
    if (fields) {
      if (fields.allWords)
        criteria.push({ label: "All words", value: fields.allWords });
      if (fields.exactPhrase)
        criteria.push({ label: "Exact phrase", value: fields.exactPhrase });
      if (fields.anyWords)
        criteria.push({ label: "Any words", value: fields.anyWords });
      if (fields.excludedWords)
        criteria.push({ label: "Exclude", value: fields.excludedWords });
    } else criteria.push({ label: "Query", value: query });
  }
  if (filters.vinPattern) {
    criteria.push({ label: "VIN pattern", value: filters.vinPattern });
  }
  if (filters.minYear || filters.maxYear) {
    criteria.push({
      label: "Year",
      value:
        filters.minYear && filters.maxYear
          ? `${filters.minYear} to ${filters.maxYear}`
          : filters.minYear
            ? `${filters.minYear} or newer`
            : `${filters.maxYear} or older`,
    });
  }
  if (filters.makes?.length) {
    criteria.push({ label: "Makes", value: filters.makes.join(", ") });
  }
  if (filters.colors?.length) {
    criteria.push({ label: "Colors", value: filters.colors.join(", ") });
  }
  if (filters.states?.length) {
    criteria.push({ label: "States", value: filters.states.join(", ") });
  }
  if (filters.salvageYards?.length) {
    criteria.push({
      label: "Yards",
      value: filters.salvageYards.join(", "),
    });
  }
  if (filters.sources?.length) {
    criteria.push({
      label: "Sources",
      value: filters.sources
        .map((source) => INGESTION_SOURCE_DISPLAY_NAMES[source])
        .join(", "),
    });
  }
  if (filters.sortBy) {
    const sort = SEARCH_SORT_OPTIONS.find(
      (option) =>
        option.key === filters.sortBy || option.indexName === filters.sortBy,
    );
    criteria.push({ label: "Sort", value: sort?.label ?? filters.sortBy });
  }
  return criteria.length > 0
    ? criteria
    : [{ label: "Search", value: "All vehicles" }];
}

export function SavedSearchCriteria({
  query,
  filters,
}: {
  query: string;
  filters: SavedSearchFilters;
}) {
  return (
    <dl className="grid gap-1.5">
      {getSavedSearchCriteria(query, filters).map((criterion) => (
        <div
          key={criterion.label}
          className="grid min-w-0 grid-cols-[6.5rem_minmax(0,1fr)] gap-3 text-sm"
        >
          <dt className="text-muted-foreground">{criterion.label}</dt>
          <dd className="min-w-0 break-words">{criterion.value}</dd>
        </div>
      ))}
    </dl>
  );
}
