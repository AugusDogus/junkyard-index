import { hasAdvancedSearchSyntax } from "./advanced-search-query";
import { SEARCHABLE_VEHICLE_YEAR_RANGE } from "./saved-search-filters";

export type SearchYearQuery = {
  query: string;
  range: readonly [number, number] | null;
};

/** A two-digit year in the window ending at the newest searchable model year. */
function fullYear(twoDigits: string): number {
  const year = Number(twoDigits);
  const pivot = SEARCHABLE_VEHICLE_YEAR_RANGE.max % 100;
  return year <= pivot ? 2000 + year : 1900 + year;
}

/**
 * People type a leading two-digit year: "08 mustang", "'98-02 civic". Only the
 * first word counts, and only before a word starting with a letter, so model
 * names such as "Toyota 86" and four-digit years keep their meaning.
 */
function leadingTwoDigitYears(query: string): SearchYearQuery {
  const match = /^'?(\d{2})(?:\s*(?:-|\.\.)\s*'?(\d{2}))?(?=\s+[a-z])/i.exec(
    query,
  );
  if (!match) return { query, range: null };
  const [lead, start, end] = match;
  if (start === undefined) return { query, range: null };
  const min = fullYear(start);
  const max = end === undefined ? min : fullYear(end);
  if (min > max) return { query, range: null };
  return { query: query.slice(lead.length), range: [min, max] };
}

/** Plain, standalone years only. Quoted/excluded/Boolean terms keep their semantics. */
function parse(input: string): SearchYearQuery {
  if (hasAdvancedSearchSyntax(input) || /(^|\s)-\S/.test(input))
    return { query: input, range: null };
  const leading = leadingTwoDigitYears(input.trim());
  const query = leading.query;
  let range: SearchYearQuery["range"] = leading.range;
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
  /**
   * The years a search applies: the Year filter narrowed by typed years.
   * Disjoint bounds match nothing, so the filter keeps its own bounds.
   */
  narrow(
    filter: readonly [number, number],
    { range }: SearchYearQuery,
  ): [number, number] {
    if (!range) return [filter[0], filter[1]];
    const min = Math.max(filter[0], range[0]);
    const max = Math.min(filter[1], range[1]);
    return min <= max ? [min, max] : [filter[0], filter[1]];
  },
} as const;
