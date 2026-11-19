import { hasAdvancedSearchSyntax } from "./advanced-search-query";
import { SEARCHABLE_VEHICLE_YEAR_RANGE } from "./saved-search-filters";

export type SearchYearQuery = {
  query: string;
  range: readonly [number, number] | null;
};

/** Plain, standalone years only. Quoted/excluded/Boolean terms keep their semantics. */
function parse(query: string): SearchYearQuery {
  if (hasAdvancedSearchSyntax(query) || /(^|\s)-\S/.test(query))
    return { query, range: null };
  let range: SearchYearQuery["range"] = null;
  const words = query.replace(
    /(^|\s)(\d{4})(?:\s*(-|\.\.)\s*(\d+))?(?=\s|$)/g,
    (
      match: string,
      space: string,
      start: string,
      separator: string | undefined,
      end: string | undefined,
      offset: number,
    ) => {
      // Do not salvage a single year from an incomplete range.
      if (
        !separator &&
        /^\s*(?:-|\.\.)/.test(query.slice(offset + match.length))
      )
        return match;
      const min = Number(start);
      let max = end === undefined ? min : Number(end);
      if (end?.length === 2) {
        max += Math.floor(min / 100) * 100;
        if (max < min) max += 100;
      }
      if (
        (end !== undefined && end.length !== 2 && end.length !== 4) ||
        min < SEARCHABLE_VEHICLE_YEAR_RANGE.min ||
        max > SEARCHABLE_VEHICLE_YEAR_RANGE.max ||
        min > max
      )
        return match;
      range = range
        ? [Math.max(range[0], min), Math.min(range[1], max)]
        : [min, max];
      return space;
    },
  );
  return { query: words.trim().replace(/\s+/g, " "), range };
}

export const SearchYearQuery = {
  parse,
  filters({ range }: SearchYearQuery): string | undefined {
    return range ? `year >= ${range[0]} AND year <= ${range[1]}` : undefined;
  },
} as const;
