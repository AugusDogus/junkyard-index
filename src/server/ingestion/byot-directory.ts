import { z } from "zod";
import directory from "./byot-directory.json";

/** Native year-specific model lists captured 2026-11-15. Manufacturer groups
 * share directory lists, but Jeep search requires its own make, including the
 * Chrysler/AMC names absent from Jeep's directory. See the qualification runbook. */
export const BYOT_QUERIES = z
  .array(
    z.object({ make: z.string().min(1), model: z.string().min(1) }).strict(),
  )
  .min(1)
  .parse(directory);
export function byotSearchUrl(code: string, index: number): string {
  const query = BYOT_QUERIES[index];
  if (!query)
    throw new Error(
      `BYOT search index ${index} is outside the qualified directory`,
    );
  return (
    "https://api.byotautoparts.com/search/vehicles?" +
    new URLSearchParams({ location: code, ...query, source: "website" })
  );
}
export const BYOT_ARRIVALS_URL =
  "https://api.byotautoparts.com/inventory/yard/vehicles/recent-arrivals?limit=5000";
