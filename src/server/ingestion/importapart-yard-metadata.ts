import { z } from "zod";
import type { Yard } from "~/lib/yard";

export const IMPORTAPART_ORIGIN = "https://importapart.com";
export const IMPORTAPART_CATALOG = IMPORTAPART_ORIGIN + "/blogs/part-outs";
export const importapartCatalogUrl = (page: number) =>
  page === 1 ? IMPORTAPART_CATALOG : `${IMPORTAPART_CATALOG}?page=${page}`;
// Native AutoPartsStore identity and donor descriptions establish ownership.
// Coordinates are the separately saved ASYD importapart-hazelwood-mo map pin.
export const IMPORTAPART_YARD = {
  source: "importapart",
  code: "hazelwood",
  name: "Importapart",
  operator: "Importapart",
  address: "7373 Hazelwood Ave",
  city: "Hazelwood",
  state: "MO",
  postalCode: "63042",
  phone: "314-502-3104",
  email: null,
  lat: 38.77462,
  lng: -90.34407,
  websiteUrl: IMPORTAPART_CATALOG,
} as const satisfies Yard;
export type ImportapartYard = typeof IMPORTAPART_YARD;

const identity = z.object({
  "@type": z.literal("AutoPartsStore"),
  name: z.literal("Importapart"),
  telephone: z.literal("+1-314-502-3104"),
  address: z.object({
    streetAddress: z.literal("7373 Hazelwood Ave"),
    addressLocality: z.literal("Hazelwood"),
    addressRegion: z.literal("MO"),
    postalCode: z.literal("63042"),
  }),
});
export function verifyImportapartYard(html: string): void {
  const scripts = [
    ...html
      .replace(/<!--[\s\S]*?-->/g, "")
      .matchAll(
        /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
      ),
  ];
  let matches = 0;
  for (const script of scripts) {
    const value: unknown = JSON.parse(script[1] ?? "null");
    if (identity.safeParse(value).success) matches++;
  }
  if (matches !== 1)
    throw new Error(
      "Importapart native physical-yard identity changed or is missing",
    );
}
