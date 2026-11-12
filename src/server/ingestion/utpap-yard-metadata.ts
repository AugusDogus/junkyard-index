import type { Yard } from "~/lib/yard";
import { stripInventoryRawText } from "./inventory-html";

export const UTPAP_ORIGIN = "https://utpap.com";
export type UtpapYardCode = "1064" | "1065";
export type UtpapYard = Yard & {
  source: "utpap";
  code: UtpapYardCode;
};

// Official yard pages and their linked Google business pins, verified 2026-11-12.
// Ogden's body has a conflicting ZIP; footer and matching business pin use 84404.
export const UTPAP_YARDS = {
  "1064": {
    source: "utpap",
    code: "1064",
    name: "Utah Pic-A-Part Ogden",
    operator: "Utah Pic-A-Part",
    city: "Ogden",
    state: "UT",
    address: "555 W. 17th Street",
    postalCode: "84404",
    phone: "801-612-6446",
    email: null,
    lat: 41.2364008,
    lng: -111.9913269,
    websiteUrl: UTPAP_ORIGIN + "/ogden-inventory/",
  },
  "1065": {
    source: "utpap",
    code: "1065",
    name: "Utah Pic-A-Part Orem",
    operator: "Utah Pic-A-Part",
    city: "Orem",
    state: "UT",
    address: "255 S. Geneva Road",
    postalCode: "84058",
    phone: "801-756-5878",
    email: null,
    lat: 40.2926496,
    lng: -111.7331302,
    websiteUrl: UTPAP_ORIGIN + "/orem-inventory/",
  },
} as const satisfies Record<UtpapYardCode, UtpapYard>;

export function utpapYardSlug(code: UtpapYardCode): "ogden" | "orem" {
  return code === "1064" ? "ogden" : "orem";
}

export function utpapMakePath(code: UtpapYardCode, make?: string): string {
  return (
    "/search-inventory_" +
    utpapYardSlug(code) +
    ".php" +
    (make === undefined ? "" : "?" + new URLSearchParams({ make, model: "" }))
  );
}

export function parseUtpapYard(html: string, code: UtpapYardCode): UtpapYard {
  if (html.length > 1_000_000 || !/<\/html>\s*$/i.test(html))
    throw new Error("Utah Pic-A-Part contact page is oversized or truncated");
  const text = stripInventoryRawText(html)
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ");
  const expected = UTPAP_YARDS[code];
  const phone = expected.phone.replace(/\D/g, "");
  if (
    !text.includes(expected.address) ||
    !text.includes(expected.city + ", UT " + expected.postalCode) ||
    !text.replace(/\D/g, "").includes(phone) ||
    !html.includes(UTPAP_ORIGIN + "/" + utpapYardSlug(code) + "-inventory/")
  )
    throw new Error(
      "Utah Pic-A-Part yard " +
        code +
        " changed contact identity; retain prior inventory and inspect its official yard page",
    );
  return expected;
}
