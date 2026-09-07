import {
  parseExpression,
  type Condition,
  type Expression,
} from "~/lib/search-expression";

export type CompiledExpression = {
  query: string;
  filters: string | undefined;
  requiresTokens: boolean;
  hasFields: boolean;
};
type Compilation =
  | { success: true; data: CompiledExpression }
  | { success: false; error: string };
type Clauses = Condition[][];
const LIMIT = 128;
const escape = (value: string) =>
  value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
const attributes = {
  text: "searchTokens",
  make: "make",
  color: "color",
  state: "state",
  yard: "locationName",
  source: "source",
} as const;

/** Algolia accepts ANDs of OR clauses. Bound distribution before multiplying groups. */
function toClauses(node: Expression): Clauses | null {
  if (node.kind === "condition") return [[node]];
  let result: Clauses = node.operator === "AND" ? [] : [[]];
  for (const child of node.children) {
    const next = toClauses(child);
    if (!next) return null;
    if (node.operator === "AND") result = [...result, ...next];
    else {
      if (result.length * next.length > LIMIT) return null;
      result = result.flatMap((left) =>
        next.map((right) => [...left, ...right]),
      );
    }
    if (result.reduce((count, clause) => count + clause.length, 0) > LIMIT)
      return null;
  }
  return result;
}

export function combineSearchFilters(
  ...filters: (string | undefined)[]
): string | undefined {
  const clauses = filters.filter((value): value is string => Boolean(value));
  return clauses.length ? clauses.join(" AND ") : undefined;
}

export function compileSearchExpression(input: string): Compilation {
  const parsed = parseExpression(input);
  if (!parsed.success) return parsed;
  const clauses = toClauses(parsed.value);
  if (!clauses)
    return {
      success: false,
      error:
        "This expression expands into too many alternatives. Use fewer OR groups.",
    };
  const query: string[] = [];
  const filters: string[] = [];
  let requiresTokens = false;
  let hasFields = false;
  for (const clause of clauses) {
    const numeric = clause.some((condition) => condition.field === "year");
    if (numeric && clause.some((condition) => condition.field !== "year"))
      return {
        success: false,
        error:
          "Year conditions cannot be combined with other fields using OR. Put the year condition in a separate AND group.",
      };
    const parts: string[] = [];
    for (const condition of clause) {
      const { field, comparison, value } = condition;
      if (field === "text" && clause.length === 1) {
        // Keep normal Algolia keyword/phrase matching for globally required text.
        query.push(
          `${comparison === "not" ? "-" : ""}${/^[\p{L}\p{N}_]+$/u.test(value) ? value : `"${escape(value)}"`}`,
        );
      } else if (field === "year") {
        hasFields = true;
        parts.push(
          `year ${comparison === "is" ? "=" : comparison === "not" ? "!=" : comparison} ${value}`,
        );
      } else {
        hasFields ||= field !== "text";
        requiresTokens ||= field === "text";
        const normalized =
          field === "text" ? value.toLocaleLowerCase("en-US") : value;
        parts.push(
          `${comparison === "not" ? "NOT " : ""}${attributes[field]}:"${escape(normalized)}"`,
        );
      }
    }
    if (parts.length)
      filters.push(
        parts.length > 1 ? `(${parts.join(" OR ")})` : (parts[0] ?? ""),
      );
  }
  const text = query.join(" ");
  if (new TextEncoder().encode(text).length > 512)
    return {
      success: false,
      error: "Keep the keyword portion of this expression under 512 bytes.",
    };
  return {
    success: true,
    data: {
      query: text,
      filters: filters.join(" AND ") || undefined,
      requiresTokens,
      hasFields,
    },
  };
}
