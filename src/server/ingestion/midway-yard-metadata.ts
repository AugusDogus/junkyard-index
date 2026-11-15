import type { Yard } from "~/lib/yard";
import { stripInventoryRawText } from "./inventory-html";

export const MIDWAY_ORIGIN = "https://midwayupull.com";
export type MidwayYardCode = "MO38" | "MO09" | "OO95";
export type MidwayInventoryCode = MidwayYardCode;
export const midwayMakeInventoryUrl = (
  code: MidwayInventoryCode,
  make: string,
) =>
  `${MIDWAY_ORIGIN}/inventory/${encodeURIComponent(make.replace(" ", "_").replace("/", "."))}/ANY/?k=1&id=${code}&view=table`;
export const midwayInventoryUrl = (code: MidwayYardCode) =>
  `${MIDWAY_ORIGIN}/inventory/ANY/ANY/?k=1&id=${code}&view=table`;

// Physical identity comes from native selectors and contact text. Coordinates
// use the separately hash-verified directory map, not image-storage prefixes.
export const MIDWAY_YARDS = {
  MO38: {
    source: "midway",
    code: "MO38",
    name: "Midway U Pull - Muncie",
    operator: "Midway U Pull",
    address: "6345 Kansas Ave",
    city: "Kansas City",
    state: "KS",
    postalCode: "66111",
    phone: "913-287-6185",
    email: null,
    lat: 39.08731,
    lng: -94.72634,
    websiteUrl: midwayInventoryUrl("MO38"),
  },
  MO09: {
    source: "midway",
    code: "MO09",
    name: "Midway U Pull - Liberty",
    operator: "Midway U Pull",
    address: "1101 Old State Hwy 210",
    city: "Liberty",
    state: "MO",
    postalCode: "64068",
    phone: "816-781-4886",
    email: null,
    lat: 39.19796,
    lng: -94.40057,
    websiteUrl: midwayInventoryUrl("MO09"),
  },
  OO95: {
    source: "midway",
    code: "OO95",
    name: "Midway U Pull - Tulsa",
    operator: "Midway U Pull",
    address: "13802 E Apache St",
    city: "Tulsa",
    state: "OK",
    postalCode: "74116",
    phone: "918-234-4444",
    email: null,
    // Census exact-address street-range interpolation, 12900-14198 E Apache St.
    lat: 36.191506616229,
    lng: -95.823681530963,
    websiteUrl: midwayInventoryUrl("OO95"),
  },
} as const satisfies Record<MidwayYardCode, Yard>;
export type MidwayYard = (typeof MIDWAY_YARDS)[MidwayYardCode];

export function parseMidwayYards(html: string): MidwayYard[] {
  const clean = stripInventoryRawText(html);
  const text = clean.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");
  if (
    html.length > 2_000_000 ||
    !/<\/html>\s*$/i.test(clean) ||
    !text.includes("Providing Fresh Inventory at a Fair Price") ||
    !text.includes("Self-Serve Locations") ||
    !Object.values(MIDWAY_YARDS).every((yard) =>
      [yard.name, yard.address, yard.city, yard.postalCode, yard.phone].every(
        (value) => text.includes(value),
      ),
    )
  )
    throw new Error(
      "Midway native self-service yard identity changed or is incomplete",
    );
  return [MIDWAY_YARDS.MO38, MIDWAY_YARDS.MO09, MIDWAY_YARDS.OO95];
}
