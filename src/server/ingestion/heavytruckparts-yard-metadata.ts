import type { Yard } from "~/lib/yard";

export interface HtpSupplier {
  code: string;
  supplier: string;
  store: string;
  itemCategory: string;
  title: string;
  location: string;
  minimum: number;
  storeClaims: readonly string[];
  yard: Yard;
}

// Four Census Public_AR_Current exact-address interpolations and two OSM
// house-address matches (Crest way 546691786, American way 274202609).
// Original geocoder responses and request receipts are saved in the test corpus.
export const HTP_SUPPLIERS = [
  {
    code: "rydemore",
    supplier: "4594927",
    store: "1",
    itemCategory: "Complete-Vehicle",
    title: "Complete Vehicle",
    location:
      "Sold by: Rydemore Heavy Duty Truck Parts Inc Location: FITCHBURG MA",
    minimum: 2,
    storeClaims: [
      "Rydemore Heavy Duty Truck Parts Inc",
      "88 BENSON STREET",
      "FITCHBURG, MA 01420",
    ],
    yard: {
      source: "heavytruckparts",
      code: "rydemore",
      name: "Rydemore Heavy Duty Truck Parts Inc",
      operator: "Rydemore Heavy Duty Truck Parts Inc",
      address: "88 BENSON STREET",
      city: "Fitchburg",
      state: "MA",
      postalCode: "01420",
      phone: "+19783421100",
      email: null,
      lat: 42.561581075475,
      lng: -71.77343412799,
      websiteUrl:
        "https://www.heavytruckparts.net/search.php?fltpc=4594927&store=1",
    },
  },
  {
    code: "westside",
    supplier: "7641244",
    store: "1",
    itemCategory: "Complete-Vehicle",
    title: "Complete Vehicle",
    location: "Sold by: West Side Truck Parts Location: OWENSBORO KY",
    minimum: 188,
    storeClaims: [
      "West Side Truck Parts",
      "1120 Crabtree ave.",
      "OWENSBORO, KY 42301",
    ],
    yard: {
      source: "heavytruckparts",
      code: "westside",
      name: "West Side Truck Parts",
      operator: "West Side Truck Parts",
      address: "1120 Crabtree ave.",
      city: "Owensboro",
      state: "KY",
      postalCode: "42301",
      phone: "+18002320222",
      email: null,
      lat: 37.764039537182,
      lng: -87.13434411735,
      websiteUrl:
        "https://www.heavytruckparts.net/search.php?fltpc=7641244&store=1",
    },
  },
  {
    code: "allcounty",
    supplier: "7712369",
    store: "1",
    itemCategory: "Complete-Vehicle",
    title: "Complete Vehicle",
    location: "Sold by: All County Truck Parts Location: Chattanooga TN",
    minimum: 13,
    storeClaims: [
      "All County Truck Parts",
      "1073 Hooker Rd",
      "Chattanooga, TN 37407",
    ],
    yard: {
      source: "heavytruckparts",
      code: "allcounty",
      name: "All County Truck Parts",
      operator: "All County Truck Parts",
      address: "1073 Hooker Rd",
      city: "Chattanooga",
      state: "TN",
      postalCode: "37407",
      phone: "+14232876057",
      email: null,
      lat: 34.989074339465,
      lng: -85.299454995885,
      websiteUrl:
        "https://www.heavytruckparts.net/search.php?fltpc=7712369&store=1",
    },
  },
  {
    code: "crest",
    supplier: "2251343",
    store: "1",
    itemCategory: "Complete-Vehicle",
    title: "Complete Vehicle",
    location: "Sold by: crest truck parts Location: CARTERSVILLE GA",
    minimum: 72,
    storeClaims: [
      "crest truck parts",
      "640 Joe Frank Harris Parkway",
      "CARTERSVILLE, GA 30120",
    ],
    yard: {
      source: "heavytruckparts",
      code: "crest",
      name: "crest truck parts",
      operator: "crest truck parts",
      address: "640 Joe Frank Harris Parkway",
      city: "Cartersville",
      state: "GA",
      postalCode: "30120",
      phone: "+18004242065",
      email: null,
      lat: 34.1597749,
      lng: -84.7884408,
      websiteUrl:
        "https://www.heavytruckparts.net/search.php?fltpc=2251343&store=1",
    },
  },
  {
    code: "catruck",
    supplier: "297005",
    store: "1",
    itemCategory: "Complete-Vehicle",
    title: "Complete Vehicle",
    location: "Sold by: CA Truck Parts Location: Opa-Locka FL",
    minimum: 1,
    storeClaims: ["CA Truck Parts", "13480 Cairo Lane", "Opa-Locka, FL 33054"],
    yard: {
      source: "heavytruckparts",
      code: "catruck",
      name: "CA Truck Parts",
      operator: "CA Truck Parts",
      address: "13480 Cairo Lane",
      city: "Opa-Locka",
      state: "FL",
      postalCode: "33054",
      phone: "+13056881101",
      email: null,
      lat: 25.896529879005,
      lng: -80.257901482201,
      websiteUrl:
        "https://www.heavytruckparts.net/search.php?fltpc=297005&store=1",
    },
  },
  {
    code: "american",
    supplier: "3857491",
    store: "1",
    itemCategory: "Vehicle-For-Sale",
    title: "Vehicle For Sale",
    location: "Sold by: American Truck Salvage Location: Phoenix AZ",
    minimum: 1,
    storeClaims: [
      "American Truck Salvage",
      "2850 West Broadway Road",
      "Phoenix, AZ 85041",
    ],
    yard: {
      source: "heavytruckparts",
      code: "american",
      name: "American Truck Salvage",
      operator: "American Truck Salvage",
      address: "2850 West Broadway Road",
      city: "Phoenix",
      state: "AZ",
      postalCode: "85041",
      phone: "+16022682288",
      email: null,
      lat: 33.4067694,
      lng: -112.120089,
      websiteUrl:
        "https://www.heavytruckparts.net/search.php?fltpc=3857491&store=1",
    },
  },
] as const satisfies readonly HtpSupplier[];

export const HTP_ORIGIN = "https://www.heavytruckparts.net";
export function htpStoreUrl(s: HtpSupplier) {
  return `${HTP_ORIGIN}/search.php?fltpc=${s.supplier}&store=${s.store}`;
}
export function htpCatalogUrl(
  s: HtpSupplier,
  direction: "DESC" | "ASC",
  page: number,
) {
  if (!Number.isSafeInteger(page) || page < 1 || page > 80)
    throw new Error("HTP catalog page must be from 1 through 80");
  return `${HTP_ORIGIN}/search/Any/Any/Complete-Vehicle?fltpc=${s.supplier}&store=${s.store}&SortBy=year${direction === "ASC" ? "&Order=asc" : ""}${page > 1 ? `&page=${page}` : ""}`;
}
/** One native model year sorted by make, in the live Next/Last param order. */
export function htpYearUrl(
  s: HtpSupplier,
  year: string,
  direction: "DESC" | "ASC",
  page: number,
) {
  if (!/^\d{4}$/.test(year))
    throw new Error("HTP year fill needs a four-digit native year");
  if (page !== 1 && page !== 2)
    throw new Error("HTP year fill page must be 1 or 2");
  return `${HTP_ORIGIN}/search/Any/Any/Complete-Vehicle?fltpc=${s.supplier}&store=${s.store}&SortBy=make${direction === "ASC" ? "&Order=asc" : ""}&year_start=${year}&year_end=${year}${page > 1 ? `&page=${page}` : ""}`;
}
