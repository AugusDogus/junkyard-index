import { YardService } from "~/lib/yard-service";
import { SearchYearQuery } from "~/lib/search-year-query";
import type { SearchCriteria } from "~/lib/search-criteria";
import { SEARCHABLE_VEHICLE_YEAR_RANGE } from "~/lib/saved-search-filters";
import { INGESTION_SOURCES } from "~/lib/ingestion-source";
import {
  parseAdvancedSearchQuery,
  getLegacyRequiredSearchTerms,
} from "~/lib/advanced-search-query";
import {
  serializeExpression,
  type Expression,
  type Field,
} from "~/lib/search-expression";
const quote = (value: string) =>
  /^[\p{L}\p{N}_*-]+$/u.test(value) &&
  !value.startsWith("-") &&
  !["AND", "OR", "NOT"].includes(value)
    ? value
    : JSON.stringify(value);

export function expressionFromCriteria(criteria: SearchCriteria): string {
  const yearQuery = SearchYearQuery.parse(criteria.query);
  const legacy = parseAdvancedSearchQuery(yearQuery.query);
  // Decode the legacy parser's result first: its OR precedence differs from this grammar.
  const words = getLegacyRequiredSearchTerms(yearQuery.query);
  const terms = words
    ? words.map(
        (term) =>
          `${term.excluded ? "!" : ""}${term.quoted ? JSON.stringify(term.value) : quote(term.value)}`,
      )
    : [yearQuery.query];
  if (legacy.success)
    for (const group of legacy.data.anyWordGroups)
      terms.push(`(${group.map(quote).join(" OR ")})`);
  const parts = terms;
  const { min, max } = SEARCHABLE_VEHICLE_YEAR_RANGE;
  const minimum = Math.max(
    criteria.yearRange[0],
    yearQuery.range?.[0] ?? criteria.yearRange[0],
  );
  const maximum = Math.min(
    criteria.yearRange[1],
    yearQuery.range?.[1] ?? criteria.yearRange[1],
  );
  if (minimum !== min) parts.push(`year:>=${minimum}`);
  if (maximum !== max) parts.push(`year:<=${maximum}`);
  const facets = [
    ["make", criteria.makes],
    ["color", criteria.colors],
    ["state", criteria.states],
    ["yard", criteria.salvageYards],
    ["source", criteria.sources],
    ["yardType", criteria.yardTypes],
  ] as const;
  for (const [field, values] of facets) {
    if (values.length)
      parts.push(
        values.length === 1
          ? `${field}:${quote(values[0] ?? "")}`
          : `(${values.map((value) => `${field}:${quote(value)}`).join(" OR ")})`,
      );
  }
  return parts.filter(Boolean).join(" AND ");
}

/** Only convert combinations the basic controls can represent without losing grouping. */
export function criteriaFromExpression(
  expression: Expression,
  base: SearchCriteria,
): SearchCriteria | null {
  const result: SearchCriteria = {
    ...base,
    queryMode: "keywords",
    query: "",
    makes: [],
    colors: [],
    states: [],
    salvageYards: [],
    sources: [],
    yardTypes: [],
    yearRange: [
      SEARCHABLE_VEHICLE_YEAR_RANGE.min,
      SEARCHABLE_VEHICLE_YEAR_RANGE.max,
    ],
  };
  const keywordNodes: Expression[] = [];
  const seen = new Set<Field>();
  const onlyText = (node: Expression): boolean =>
    node.kind === "condition"
      ? node.field === "text"
      : node.children.every(onlyText);
  const add = (node: Expression): boolean => {
    if (onlyText(node)) {
      keywordNodes.push(node);
      return true;
    }
    if (node.kind === "group" && node.operator === "AND")
      return node.children.every(add);
    const nodes = node.kind === "group" ? node.children : [node];
    const first = nodes[0];
    if (!first || first.kind !== "condition") return false;
    const field = first.field;
    if (
      !nodes.every((item) => item.kind === "condition" && item.field === field)
    )
      return false;
    if (field !== "year" && seen.has(field)) return false;
    seen.add(field);
    for (const item of nodes) {
      if (item.kind !== "condition") return false;
      if (field === "year") {
        if (nodes.length > 1 || item.comparison === "not") return false;
        const year = Number(item.value);
        if (
          year < SEARCHABLE_VEHICLE_YEAR_RANGE.min ||
          year > SEARCHABLE_VEHICLE_YEAR_RANGE.max
        )
          return false;
        if (item.comparison === "is")
          result.yearRange = [
            Math.max(result.yearRange[0], year),
            Math.min(result.yearRange[1], year),
          ];
        else if (item.comparison === ">" || item.comparison === ">=")
          result.yearRange[0] = Math.max(
            result.yearRange[0],
            year + (item.comparison === ">" ? 1 : 0),
          );
        else
          result.yearRange[1] = Math.min(
            result.yearRange[1],
            year - (item.comparison === "<" ? 1 : 0),
          );
      } else {
        if (item.comparison !== "is") return false;
        if (field === "make") result.makes.push(item.value);
        if (field === "color") result.colors.push(item.value);
        if (field === "state") result.states.push(item.value);
        if (field === "yard") result.salvageYards.push(item.value);
        if (field === "yardType") {
          const type = YardService.parseType(item.value);
          if (type) result.yardTypes.push(type);
          else return false;
        }
        if (field === "source") {
          const source = INGESTION_SOURCES.find(
            (value) => value === item.value,
          );
          if (source !== undefined) result.sources.push(source);
          else return false;
        }
      }
    }
    return true;
  };
  if (!add(expression) || result.yearRange[0] > result.yearRange[1])
    return null;
  const basicWords: string[] = [];
  const collectBasicWords = (node: Expression): boolean => {
    if (node.kind === "group")
      return node.operator === "AND" && node.children.every(collectBasicWords);
    if (node.comparison !== "is" || quote(node.value) !== node.value)
      return false;
    basicWords.push(node.value);
    return true;
  };
  result.query = keywordNodes.every(collectBasicWords)
    ? basicWords.join(" ")
    : serializeExpression({
        kind: "group",
        operator: "AND",
        children: keywordNodes,
      });
  return result;
}
