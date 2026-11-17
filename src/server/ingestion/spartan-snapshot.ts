import { shopifyYardSnapshot } from "./shopify-yard-snapshot";
import type { SpartanPage } from "./spartan-parser";
import { SPARTAN_MINIMUM, SPARTAN_YARD } from "./spartan-yard-metadata";

// The shared donor snapshot validates identities, rejects conflicts, retains
// observed VINs and applies the same guards used for other single-yard APIs.
export function spartanSnapshot(
  pages: readonly SpartanPage[],
  previous: number | null,
) {
  return shopifyYardSnapshot(
    pages.flatMap((page) =>
      page.rows.map((row) => ({
        id: String(row.id),
        vin: row.vin,
        year: String(row.year),
        make: row.make,
        model: row.model,
        status: "active" as const,
        reasons: [],
        detailsUrl: `https://www.spartanauto.parts/${row.type}-catalog/${row.id}`,
        imageUrl: row.imageUrl,
        color: row.color,
        stockNumber: row.stock || null,
      })),
    ),
    SPARTAN_YARD,
    "South Carolina",
    SPARTAN_MINIMUM,
    previous,
  );
}
