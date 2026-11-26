export const SEARCH_RADIUS_MILES = [25, 50, 100, 250, 500] as const;
export type SearchRadiusMiles = (typeof SEARCH_RADIUS_MILES)[number];

export const SearchRadius = {
  parse(value: unknown): number | null {
    const miles = typeof value === "string" ? Number(value) : value;
    return SEARCH_RADIUS_MILES.find((option) => option === miles) ?? null;
  },
  meters(miles: number | null): number | "all" {
    return miles === null ? "all" : Math.round(miles * 1609.344);
  },
} as const;
