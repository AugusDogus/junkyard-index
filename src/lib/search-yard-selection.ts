import { SearchFilterUrl } from "./search-filter-url";
import { YardService, type YardType } from "./yard-service";

/** Missing URL values default to self-service. Missing persisted values are legacy all. */
export type SearchYardSelection =
  | { kind: "default" }
  | { kind: "explicit"; types: YardType[] };

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
  return types.length ? { kind: "explicit", types } : { kind: "default" };
}

function effectiveTypes(selection: SearchYardSelection): YardType[] {
  return selection.kind === "default" ? ["self_service"] : selection.types;
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
  fromSaved,
  effectiveTypes,
  suggestion,
  fallbackThreshold,
} as const;
