import { compileSearchExpression } from "~/lib/compile-search-expression";
import { SearchCriteria } from "~/lib/search-criteria";
import {
  filtersSchema,
  type SavedSearchFilters,
} from "~/lib/saved-search-filters";
import { expressionFromCriteria } from "~/lib/search-expression-criteria";

export type Draft = {
  id: string;
  name: string;
  criteria: SearchCriteria;
  expression: string | null;
  email: boolean;
  discord: boolean;
};

type Search = {
  id: string;
  name: string;
  query: string;
  filters: SavedSearchFilters;
  emailAlertsEnabled: boolean;
  discordAlertsEnabled: boolean;
};
export function savedSearchDraft(search: Search): Draft {
  const criteria = SearchCriteria.fromSavedSearch(
    search.filters.expression === undefined ? search.query : "",
    search.filters,
  );
  // A stored range can predate the normal inventory slider or outlive its creation year.
  const minimum = search.filters.minYear ?? criteria.yearRange[0];
  const maximum = search.filters.maxYear ?? criteria.yearRange[1];
  criteria.yearRange = [Math.min(minimum, maximum), Math.max(minimum, maximum)];
  const extraFilters = expressionFromCriteria({
    ...criteria,
    query: "",
    queryMode: "keywords",
  });
  const expression =
    search.filters.expression === undefined
      ? null
      : extraFilters
        ? [
            search.filters.expression.trim()
              ? `(${search.filters.expression})`
              : "",
            extraFilters,
          ]
            .filter(Boolean)
            .join(" AND ")
        : search.filters.expression;
  return {
    id: search.id,
    name: search.name,
    criteria,
    expression,
    email: search.emailAlertsEnabled,
    discord: search.discordAlertsEnabled,
  };
}

/** Cosmetic edits retain the stored payload so alert cursors do not restart. */
export function serializeSavedSearchDraft(
  draft: Draft,
  original?: Search,
):
  | { success: true; data: { query: string; filters: SavedSearchFilters } }
  | { success: false; error: string } {
  if (original) {
    const initial = savedSearchDraft(original);
    const matching = (value: Draft) =>
      value.criteria.queryMode === "vin"
        ? JSON.stringify({ ...value.criteria, sortBy: "" })
        : (() => {
            const text =
              value.expression ?? expressionFromCriteria(value.criteria);
            const compiled = compileSearchExpression(text);
            return compiled.success ? JSON.stringify(compiled.data) : text;
          })();
    if (matching(initial) === matching(draft))
      return {
        success: true,
        data: {
          query: original.query,
          filters: { ...original.filters, sortBy: draft.criteria.sortBy },
        },
      };
  }
  if (draft.expression !== null) {
    const parsed = filtersSchema.safeParse({
      expression: draft.expression,
      sortBy: draft.criteria.sortBy,
    });
    return parsed.success
      ? { success: true, data: { query: "", filters: parsed.data } }
      : {
          success: false,
          error:
            parsed.error.issues[0]?.message ??
            "Check the expression before saving.",
        };
  }
  return SearchCriteria.toSavedSearch(draft.criteria);
}
