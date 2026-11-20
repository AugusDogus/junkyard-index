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

/**
 * Both tenants sit behind a Cloudways Varnish cache that served inventory
 * pages up to 40 hours old, each page from a different snapshot. A unique
 * `cb` query parameter misses that cache, and the plugin reflects it into the
 * search form and every pagination link. Requests carry a fresh nonce here;
 * cursors, page hashes and continuations stay canonical without it.
 */
export function alln1CacheBustUrl(raw: string, nonce: string): string {
  const url = new URL(raw);
  // The verified live requests put cb after k and view, before pagenum or
  // search.
  const trailing = new Set(["pagenum", "search"]);
  const entries = [...url.searchParams];
  url.search = new URLSearchParams([
    ...entries.filter(([key]) => !trailing.has(key)),
    ["cb", nonce],
    ...entries.filter(([key]) => trailing.has(key)),
  ]).toString();
  return url.href;
}

/**
 * Only native unfiltered inventory continuations, never additional selectors.
 * With `nonce`, the continuation must carry exactly that reflected `cb` value.
 */
export function alln1PageNumber(
  raw: string,
  tenant: Alln1Tenant = ALLN1_TENANT,
  nonce: string | null = null,
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
  const keys =
    nonce === null ? ["k", "view", "pagenum"] : ["k", "view", "cb", "pagenum"];
  if (
    entries.some(([key]) => !keys.includes(key)) ||
    keys.some(
      (key) =>
        url.searchParams.getAll(key).length !==
        (key === "pagenum" && !url.searchParams.has(key) ? 0 : 1),
    ) ||
    url.searchParams.get("k") !== "1" ||
    url.searchParams.get("view") !== "table" ||
    (nonce !== null && url.searchParams.get("cb") !== nonce)
  )
    return null;
  const rawPage = url.searchParams.get("pagenum") ?? "1";
  return /^[1-9]\d*$/.test(rawPage) && Number(rawPage) <= ALLN1_MAX_PAGES
    ? Number(rawPage)
    : null;
}
/**
 * The native search for one Set Date, which lists every donor set on that
 * date on one page while fewer than 500 match. It recovers donors a Set Date
 * tie hid from the paginated census.
 */
export function alln1SearchUrl(
  date: string,
  tenant: Alln1Tenant = ALLN1_TENANT,
): string {
  return tenant.inventoryUrl + "&search=" + date;
}
/**
 * The ISO date searched by `raw`, or null unless it is exactly the tenant's
 * native table with `k=1`, `view=table`, one ISO calendar date as `search`
 * and, with `nonce`, exactly that `cb` value.
 */
export function alln1SearchDate(
  raw: string,
  tenant: Alln1Tenant = ALLN1_TENANT,
  nonce: string | null = null,
): string | null {
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
  const keys =
    nonce === null ? ["k", "view", "search"] : ["k", "view", "cb", "search"];
  const entries = [...url.searchParams];
  const search = url.searchParams.get("search") ?? "";
  const date = /^\d{4}-\d{2}-\d{2}$/.test(search)
    ? new Date(search + "T00:00:00.000Z")
    : null;
  return entries.length === keys.length &&
    keys.every((key) => url.searchParams.getAll(key).length === 1) &&
    url.searchParams.get("k") === "1" &&
    url.searchParams.get("view") === "table" &&
    (nonce === null || url.searchParams.get("cb") === nonce) &&
    date !== null &&
    Number.isFinite(date.getTime()) &&
    date.toISOString().slice(0, 10) === search
    ? search
    : null;
}
/** The canonical continuation of a page link verified with its nonce. */
export function alln1WithoutCacheBust(raw: string): string {
  const url = new URL(raw);
  url.searchParams.delete("cb");
  return url.href;
}
export function alln1DetailsUrl(
  vin: string,
  tenant: Alln1Tenant = ALLN1_TENANT,
): string {
  return tenant.inventoryUrl + "&search=" + encodeURIComponent(vin);
}
