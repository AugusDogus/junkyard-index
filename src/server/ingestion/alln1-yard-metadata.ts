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
export type Alln1Source = "alln1" | "grandpajohns";
export type Alln1Yard<S extends Alln1Source = "alln1"> = Omit<
  Yard,
  "source" | "address" | "lat" | "lng"
> & { source: S; address: string; lat: number; lng: number };
export interface Alln1Tenant<S extends Alln1Source = Alln1Source> {
  source: S;
  origin: string;
  inventoryUrl: string;
  yard: Alln1Yard<S>;
  ownerClaims: readonly string[];
  ownerPhoneDigits: string | null;
  ownerDescription: string;
  vinValidation: "syntax" | "check-digit";
}
export const ALLN1_TENANT: Alln1Tenant<"alln1"> = {
  source: "alln1",
  vinValidation: "syntax",
  origin: ALLN1_ORIGIN,
  inventoryUrl: ALLN1_INVENTORY_URL,
  yard: ALLN1_YARD,
  ownerClaims: [ALLN1_YARD.address, "Kansas City, MO 64129"],
  ownerPhoneDigits: "8162523930",
  ownerDescription: "self-service junkyard in Kansas City, MO",
};

// Census exact-address point, separately saved with the native owner controls.
export const GRANDPAJOHNS_TENANT: Alln1Tenant<"grandpajohns"> = {
  source: "grandpajohns",
  vinValidation: "check-digit",
  origin: "https://grandpajohnsautoparts.com",
  inventoryUrl:
    "https://grandpajohnsautoparts.com/inventory/ANY/ANY/?k=1&view=table",
  yard: {
    source: "grandpajohns",
    code: "WI25",
    name: "Grandpa John's Pick & Pull",
    operator: "Grandpa John's Pick & Pull",
    address: "1746 Velp Avenue",
    city: "Green Bay",
    state: "WI",
    postalCode: "54303",
    lat: 44.552055694176,
    lng: -88.053118559214,
    phone: null,
    email: null,
    websiteUrl: "https://grandpajohnsautoparts.com/",
  },
  ownerClaims: ["Grandpa John’s", "1746 Velp Avenue", "Green Bay, WI 54303"],
  // The official root publishes no phone. Its address and self-pull statement
  // establish ownership; never borrow the neighboring full-service yard's phone.
  ownerPhoneDigits: null,
  ownerDescription:
    "you are able to offset the cost of making a repair to your auto by pulling your needed parts in our yard using your tools.",
};

/** Only native unfiltered inventory continuations, never additional selectors. */
export function alln1PageNumber(
  raw: string,
  tenant: Alln1Tenant = ALLN1_TENANT,
): number | null {
  const url = URL.parse(raw);
  if (
    !url ||
    url.origin !== tenant.origin ||
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
export function alln1DetailsUrl(
  vin: string,
  tenant: Alln1Tenant = ALLN1_TENANT,
): string {
  return tenant.inventoryUrl + "&search=" + encodeURIComponent(vin);
}
