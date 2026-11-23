import { ARRIVAL_WINDOWS, type ArrivalWindow } from "~/lib/arrival-window";
import { HiddenSources } from "~/lib/hidden-source";
import type { DataSource } from "~/lib/types";
import type { YardType } from "~/lib/yard-service";

/** Where a distance radius is measured from. */
export type DistanceOrigin =
  | { kind: "zip"; zipCode: string }
  | { kind: "savedSearch" }
  | { kind: "approximate" };

type ListKind = "makes" | "colors" | "states" | "salvageYards";

/** One non-default choice on the search page, shown as a removable chip. */
export type ActiveSearchFilter =
  | { kind: "arrival"; window: ArrivalWindow }
  | { kind: "distance"; miles: number; origin: DistanceOrigin }
  | { kind: "yardTypes"; types: YardType[] }
  | { kind: "year"; range: [number, number] }
  | { kind: ListKind; values: string[] }
  | { kind: "sources"; sources: DataSource[] };

export interface ActiveSearchFilterInput {
  arrivalWindow: ArrivalWindow | undefined;
  radiusMiles: number | null;
  origin: DistanceOrigin;
  yardTypes: YardType[];
  /** Self-service, or none when the expression owns its yard types. */
  defaultYardTypes: readonly YardType[];
  yearRange: [number, number];
  yearLimits: { min: number; max: number };
  makes: string[];
  colors: string[];
  states: string[];
  salvageYards: string[];
  sources: DataSource[];
}

const LIST_NOUNS: Record<ListKind, string> = {
  makes: "makes",
  colors: "colors",
  states: "states",
  salvageYards: "yards",
};

function sameTypes(left: readonly YardType[], right: readonly YardType[]) {
  return (
    left.length === right.length && left.every((type) => right.includes(type))
  );
}

function list(input: ActiveSearchFilterInput): ActiveSearchFilter[] {
  const filters: ActiveSearchFilter[] = [];
  if (input.arrivalWindow)
    filters.push({ kind: "arrival", window: input.arrivalWindow });
  if (input.radiusMiles !== null)
    filters.push({
      kind: "distance",
      miles: input.radiusMiles,
      origin: input.origin,
    });
  if (!sameTypes(input.yardTypes, input.defaultYardTypes))
    filters.push({ kind: "yardTypes", types: input.yardTypes });
  if (
    input.yearRange[0] !== input.yearLimits.min ||
    input.yearRange[1] !== input.yearLimits.max
  )
    filters.push({ kind: "year", range: input.yearRange });
  for (const kind of ["makes", "colors", "states", "salvageYards"] as const)
    if (input[kind].length > 0) filters.push({ kind, values: input[kind] });
  if (input.sources.length > 0)
    filters.push({ kind: "sources", sources: input.sources });
  return filters;
}

function yardTypesLabel(types: readonly YardType[]): string {
  if (types.length === 0) return "All yards";
  if (types.includes("self_service") && types.includes("full_service"))
    return "Full-service included";
  return types.includes("full_service")
    ? "Full-service only"
    : "Self-service only";
}

function label(filter: ActiveSearchFilter): string {
  switch (filter.kind) {
    case "arrival":
      return (
        ARRIVAL_WINDOWS.find((option) => option.value === filter.window)
          ?.label ?? filter.window
      );
    case "distance": {
      const within = `Within ${filter.miles} mi`;
      if (filter.origin.kind === "zip")
        return `${within} of ${filter.origin.zipCode}`;
      return filter.origin.kind === "savedSearch"
        ? `${within} of saved location`
        : within;
    }
    case "yardTypes":
      return yardTypesLabel(filter.types);
    case "year":
      return filter.range[0] === filter.range[1]
        ? String(filter.range[0])
        : `${filter.range[0]} to ${filter.range[1]}`;
    case "sources":
      return `${HiddenSources.shown(filter.sources).length} sources`;
    case "makes":
    case "colors":
    case "states":
    case "salvageYards":
      return filter.values.length <= 2
        ? filter.values.join(", ")
        : `${filter.values.length} ${LIST_NOUNS[filter.kind]}`;
  }
}

export const ActiveSearchFilter = { list, label } as const;
