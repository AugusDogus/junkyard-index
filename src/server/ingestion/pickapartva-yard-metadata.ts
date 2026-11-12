import type { Yard } from "~/lib/yard";

export const PICKAPARTVA_ORIGIN = "https://pickapartva.com";
export const PICKAPARTVA_CATALOG = `${PICKAPARTVA_ORIGIN}/inventory/ANY/ANY/?k=1&id=ANY&pagenum=1`;
export const PICKAPARTVA_MAX_PAGES = 15;
export const PICKAPARTVA_PAGE_SIZE = 500;
export type PickapartvaYardCode = "TT87" | "UU81";

// Native footer/selector ownership, corroborated by the saved exact-address
// U-Pull Scan JSON-LD maps. Storage prefixes alone never establish geography.
export const PICKAPARTVA_YARDS = {
  TT87: {
    source: "pickapartva",
    code: "TT87",
    name: "Pick-A-Part Recycled Auto Parts - Fredericksburg",
    operator: "Pick-A-Part Recycled Auto Parts",
    address: "9001 Patriot Hwy",
    city: "Fredericksburg",
    state: "VA",
    postalCode: "22407",
    phone: "540-693-1028",
    email: null,
    lat: 38.271385,
    lng: -77.492726,
    websiteUrl: PICKAPARTVA_CATALOG,
  },
  UU81: {
    source: "pickapartva",
    code: "UU81",
    name: "Pick-A-Part Recycled Auto Parts - Stafford",
    operator: "Pick-A-Part Recycled Auto Parts",
    address: "164 Norman Rd.",
    city: "Stafford",
    state: "VA",
    postalCode: "22554",
    phone: "540-659-6800",
    email: null,
    lat: 38.461178,
    lng: -77.363489,
    websiteUrl: PICKAPARTVA_CATALOG,
  },
} as const satisfies Record<PickapartvaYardCode, Yard>;
export type PickapartvaYard = (typeof PICKAPARTVA_YARDS)[PickapartvaYardCode];

export function pickapartvaPageUrl(raw: string, page?: number): string | null {
  const url = URL.parse(raw, PICKAPARTVA_ORIGIN);
  if (
    !url ||
    url.origin !== PICKAPARTVA_ORIGIN ||
    url.username ||
    url.password ||
    url.hash ||
    url.pathname !== "/inventory/ANY/ANY/"
  )
    return null;
  const number = url.searchParams.get("pagenum") ?? "";
  if (
    !/^[1-9]\d*$/.test(number) ||
    Number(number) > PICKAPARTVA_MAX_PAGES ||
    (page !== undefined && Number(number) !== page)
  )
    return null;
  const entries = [...url.searchParams.entries()];
  if (
    entries.length !== 3 ||
    url.searchParams.get("k") !== "1" ||
    url.searchParams.get("id") !== "ANY" ||
    new Set(entries.map(([key]) => key)).size !== 3
  )
    return null;
  return url.href;
}
