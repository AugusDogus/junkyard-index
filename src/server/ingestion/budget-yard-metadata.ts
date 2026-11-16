import type { Yard } from "~/lib/yard";
export const BUDGET_CATALOG = "https://budgetupullit.com/current-inventory/";
export const BUDGET_MINIMUM = 535;
export type BudgetYard = Omit<Yard, "source" | "lat" | "lng"> & {
  source: "budget";
  lat: number;
  lng: number;
};
// Official inventory page address, phone and published map marker.
export const BUDGET_YARD = {
  source: "budget",
  code: "winter-garden",
  name: "Budget U Pull It",
  operator: "Budget U Pull It",
  address: "881 South 9th Street",
  city: "Winter Garden",
  state: "FL",
  postalCode: "34787",
  phone: "407-656-4707",
  email: null,
  lat: 28.553931,
  lng: -81.574973,
  websiteUrl: "https://budgetupullit.com/",
} as const satisfies BudgetYard;
export function budgetPageUrl(make: string): string {
  if (make.length > 100 || [...make].some((char) => char.charCodeAt(0) < 32))
    throw new Error("Budget make is outside the native directory bounds");
  return BUDGET_CATALOG + "?make=" + encodeURIComponent(make) + "&model=";
}
