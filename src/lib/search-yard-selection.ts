import { parseExpression, type Expression } from "./search-expression";
import { SearchFilterUrl } from "./search-filter-url";
import { YardService, type YardType } from "./yard-service";

/** Missing URL values default to self-service. Missing persisted values are legacy all. */
export type SearchYardSelection =
  | { kind: "default" }
  | { kind: "explicit"; types: YardType[] }
  | { kind: "expression"; types: YardType[] };

function fromUrl(params: URLSearchParams): SearchYardSelection {
  const values = SearchFilterUrl.read(params, "yardTypes");
  if (values.includes("all")) return { kind: "explicit", types: [] };
  const types = [
    ...new Set(
      values.flatMap((value) => {
        const type = YardService.parseType(value);
        return type ? [type] : [];
      }),
    ),
  ];
  if (types.length) return { kind: "explicit", types };
  const terms =
    params.get("syntax") === "expression"
      ? expressionTypes(params.get("q") ?? "")
      : [];
  return terms.length
    ? { kind: "expression", types: terms }
    : { kind: "default" };
}

function expressionTypes(query: string): YardType[] {
  const parsed = parseExpression(query);
  if (!parsed.success) return [];
  function collect(node: Expression): YardType[] {
    if (node.kind === "group") return node.children.flatMap(collect);
    const type =
      node.field === "yardType" ? YardService.parseType(node.value) : null;
    return type ? [type] : [];
  }
  return [...new Set(collect(parsed.value))];
}

/** Additional facet restrictions. The expression itself owns its Boolean matching. */
function effectiveTypes(selection: SearchYardSelection): YardType[] {
  if (selection.kind === "default") return ["self_service"];
  return selection.kind === "expression" ? [] : selection.types;
}

/**
 * Whether `params`, which carry no yard types yet, already select `types`.
 * The self-service default and expression-owned types need no URL value.
 */
function isImplied(
  params: URLSearchParams,
  types: readonly YardType[],
): boolean {
  const implied = effectiveTypes(fromUrl(params));
  return (
    implied.length === types.length &&
    implied.every((type) => types.includes(type))
  );
}

function fromSaved(types: YardType[] | undefined): SearchYardSelection {
  return { kind: "explicit", types: types ?? [] };
}

// Below three matches, offer a prominent recovery alongside the remaining results.
const fallbackThreshold = 3;
function suggestion(
  selfServiceCount: number,
  extraCount: number,
): "none" | "fallback" | "hint" {
  if (extraCount <= 0) return "none";
  return selfServiceCount < fallbackThreshold ? "fallback" : "hint";
}

export const SearchYardSelection = {
  fromUrl,
  expressionTypes,
  fromSaved,
  effectiveTypes,
  isImplied,
  suggestion,
  fallbackThreshold,
} as const;
