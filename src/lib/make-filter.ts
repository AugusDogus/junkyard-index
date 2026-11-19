import type { FacetFilters } from "algoliasearch/lite";
import { VehicleName } from "./vehicle-name";

/** Match a record's canonical make or the make under which it was saved. */
function aliases(make: string, sourceMake?: string | null): string[] {
  return [
    ...new Set([
      make,
      ...(sourceMake ? [sourceMake, VehicleName.makeName(sourceMake)] : []),
    ]),
  ];
}

/** An exact make token in the already-filterable searchTokens field. */
function token(make: string): string {
  return `make=${make.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US")}`;
}

function bridgeAlternative(filter: FacetFilters): string[][] {
  if (typeof filter === "string") {
    if (!filter.startsWith("make:")) return [[filter]];
    const value = filter.slice(5);
    // NOT (make OR token) is two AND clauses, including inside OR groups.
    return value.startsWith("-")
      ? [[filter], [`searchTokens:-${token(value.slice(1))}`]]
      : [[filter, `searchTokens:${token(value)}`]];
  }
  return filter.reduce<string[][]>(
    (clauses, alternative) => {
      const next = bridgeAlternative(alternative);
      return clauses.flatMap((left) =>
        next.map((right) => [...left, ...right]),
      );
    },
    [[]],
  );
}

/** Keep cached pre-readiness clients compatible with both record formats. */
function facets(filters: FacetFilters, aliasesReady = true): FacetFilters {
  if (!aliasesReady) {
    const clauses =
      typeof filters === "string"
        ? bridgeAlternative(filters)
        : filters.flatMap(bridgeAlternative);
    return clauses.map((clause) =>
      clause.length === 1 ? (clause[0] ?? "") : clause,
    );
  }
  if (typeof filters === "string")
    return filters.replace(/^make:/, "makeAliases:");
  return filters.map((filter) => facets(filter, true));
}

export const MakeFilter = { aliases, token, facets } as const;
