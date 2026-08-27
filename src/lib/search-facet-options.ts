export interface SearchFacetOptions {
  makes: string[];
  colors: string[];
  states: string[];
  salvageYards: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readFacetValues(facets: unknown, attribute: string): string[] {
  if (!isRecord(facets)) return [];

  const values = facets[attribute];
  if (!isRecord(values)) return [];

  return Object.keys(values).sort((left, right) => left.localeCompare(right));
}

export function mapSearchFacetOptions(facets: unknown): SearchFacetOptions {
  return {
    makes: readFacetValues(facets, "make"),
    colors: readFacetValues(facets, "color"),
    states: readFacetValues(facets, "state"),
    salvageYards: readFacetValues(facets, "locationName"),
  };
}
