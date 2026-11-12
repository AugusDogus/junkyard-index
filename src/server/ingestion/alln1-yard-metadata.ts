import type { Yard } from "~/lib/yard";

export const ALLN1_ORIGIN = "https://alln1kc.com";
export const ALLN1_INVENTORY_URL =
  ALLN1_ORIGIN + "/inventory/ANY/ANY/?k=1&view=table";
export const ALLN1_PAGE_SIZE = 500;
export const ALLN1_MAX_PAGES = 20;
export const ALLN1_MAX_RECORDS = ALLN1_PAGE_SIZE * ALLN1_MAX_PAGES;

// Native root, inline MO42 assignment and saved grid prove physical ownership.
// Coordinates are the separately labelled UPullScan exact-address business pin.
// The native map publishes a viewport center, not a separately verified marker.
export const ALLN1_YARD = {
  source: "alln1",
  code: "MO42",
  name: "All-N-1 U Pull & Metals Recycling",
  operator: "All-N-1 Auto Parts",
  address: "2408 Blue Ridge Blvd",
  city: "Kansas City",
  state: "MO",
  postalCode: "64129",
  phone: "816-252-3930",
  email: null,
  lat: 39.07918,
  lng: -94.471004,
  websiteUrl: ALLN1_INVENTORY_URL,
} as const satisfies Yard;
export type Alln1Yard = typeof ALLN1_YARD;

/** Only native unfiltered inventory continuations, never additional selectors. */
export function alln1PageNumber(raw: string): number | null {
  const url = URL.parse(raw);
  if (
    !url ||
    url.origin !== ALLN1_ORIGIN ||
    url.pathname !== "/inventory/ANY/ANY/" ||
    url.username ||
    url.password ||
    url.hash
  )
    return null;
  const entries = [...url.searchParams];
  if (
    entries.some(([key]) => !["k", "view", "pagenum"].includes(key)) ||
    ["k", "view", "pagenum"].some(
      (key) =>
        url.searchParams.getAll(key).length !==
        (key === "pagenum" && !url.searchParams.has(key) ? 0 : 1),
    ) ||
    url.searchParams.get("k") !== "1" ||
    url.searchParams.get("view") !== "table"
  )
    return null;
  const rawPage = url.searchParams.get("pagenum") ?? "1";
  return /^[1-9]\d*$/.test(rawPage) && Number(rawPage) <= ALLN1_MAX_PAGES
    ? Number(rawPage)
    : null;
}
export function alln1DetailsUrl(vin: string): string {
  return ALLN1_INVENTORY_URL + "&search=" + encodeURIComponent(vin);
}
