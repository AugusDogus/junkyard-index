import type { Yard } from "~/lib/yard";

export const PONTIAC_ORIGIN = "https://u-pullandsave.com";
// Verified official contact and named business pin, not the map viewport.
// Mason is vehicle purchasing only. See the Pontiac qualification runbook.
export const PONTIAC_YARD = {
  source: "pontiac",
  code: "105",
  name: "U-Pull and Save Pontiac",
  operator: "U-Pull and Save",
  address: "240 E. Columbia",
  city: "Pontiac",
  state: "MI",
  postalCode: "48340",
  phone: "+12486185000",
  email: null,
  lat: 42.6684624,
  lng: -83.2932624,
  websiteUrl: PONTIAC_ORIGIN + "/used-car-parts-pontiac",
} as const satisfies Yard;

export function parsePontiacContact(html: string): typeof PONTIAC_YARD {
  if (!/<\/html>\s*$/i.test(html))
    throw new Error("Official Pontiac contact page is truncated");
  const stores = [
    ...html.matchAll(
      /<div\b[^>]*itemtype="https?:\/\/schema\.org\/AutoPartsStore"[^>]*>([\s\S]*?)<\/div>/g,
    ),
  ]
    .map((m) => m[1] ?? "")
    .filter((store) =>
      /itemprop="name"[^>]*>\s*U-Pull and Save Pontiac\s*</.test(store),
    );
  const store = stores[0];
  const properties = store
    ? new Map(
        [
          ...store.matchAll(
            /<span\b[^>]*itemprop="(streetAddress|addressLocality|addressRegion|postalCode)"[^>]*>([^<]*)<\/span>/g,
          ),
        ].map((m) => [m[1], m[2]?.trim()]),
      )
    : new Map<string, string>();
  if (
    stores.length !== 1 ||
    !store ||
    properties.size !== 4 ||
    properties.get("streetAddress") !== PONTIAC_YARD.address ||
    properties.get("addressLocality") !== PONTIAC_YARD.city ||
    properties.get("addressRegion") !== PONTIAC_YARD.state ||
    properties.get("postalCode") !== PONTIAC_YARD.postalCode ||
    !/itemprop="telephone"[^>]*content="\+12486185000"/.test(store) ||
    !store.includes("Vehicle Purchasing &amp; Part Sales")
  ) {
    throw new Error(
      "Official Pontiac yard contact identity changed or is ambiguous; retain the previous inventory and inspect the official location page before retrying",
    );
  }
  return PONTIAC_YARD;
}
