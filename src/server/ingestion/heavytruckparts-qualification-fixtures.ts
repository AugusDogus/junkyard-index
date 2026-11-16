import type { HtpSupplier } from "./heavytruckparts-yard-metadata";
// Native stores that fail the 10% quality guard, never part of the source roster.
export const HTP_REJECTED_SUPPLIERS = [
  {
    code: "vriens",
    supplier: "5166545",
    store: "1",
    itemCategory: "Vehicle-For-Sale",
    title: "Vehicle For Sale",
    location: "Sold by: Vriens Truck Parts Location: SALT LAKE CITY UT",
    minimum: 1,
    storeClaims: [
      "Vriens Truck Parts",
      "1575 Beck St",
      "SALT LAKE CITY, UT 84116",
    ],
    yard: {
      source: "heavytruckparts",
      code: "vriens",
      name: "Vriens Truck Parts",
      operator: "Vriens Truck Parts",
      address: "1575 Beck St",
      city: "Salt Lake City",
      state: "UT",
      postalCode: "84116",
      phone: "+1877522002",
      email: null,
      lat: 0,
      lng: 0,
      websiteUrl:
        "https://www.heavytruckparts.net/search.php?fltpc=5166545&store=1",
    },
  },
  {
    code: "cohen",
    supplier: "2691298",
    store: "1",
    itemCategory: "Truck-For-Sale",
    title: "Truck For Sale",
    location: "Sold by: WM. Cohen &amp; Sons Location: Thorndale PA",
    minimum: 1,
    storeClaims: [
      "WM. Cohen & Sons",
      "4109 E Lincoln Hwy",
      "Thorndale, PA 19372",
    ],
    yard: {
      source: "heavytruckparts",
      code: "cohen",
      name: "WM. Cohen & Sons",
      operator: "WM. Cohen  Sons",
      address: "4109 E Lincoln Hwy",
      city: "Thorndale",
      state: "PA",
      postalCode: "19372",
      phone: "+16102691298",
      email: null,
      lat: 0,
      lng: 0,
      websiteUrl:
        "https://www.heavytruckparts.net/search.php?fltpc=2691298&store=1",
    },
  },
] as const satisfies readonly HtpSupplier[];

// B&W's complete roster is dealer stock, not a qualified salvage supplier.
// Retained only to replay the saved retail evidence, including Please Call rows.
export const HTP_RETAIL_SUPPLIER = {
  code: "bw",
  supplier: "1586091",
  store: "1",
  itemCategory: "Complete-Vehicle",
  title: "Complete Vehicle",
  location: "Sold by: B &amp; W Truck Center Location: AIKEN SC",
  minimum: 15,
  storeClaims: [
    "B & W Truck Center",
    "278 Jefferson Davis Hwy",
    "AIKEN, SC 29801",
  ],
  yard: {
    source: "heavytruckparts",
    code: "bw",
    name: "B & W Truck Center",
    operator: "B  W  Truck Center",
    address: "278 Jefferson Davis Hwy",
    city: "Aiken",
    state: "SC",
    postalCode: "29801",
    phone: "+18009223219",
    email: null,
    lat: 33.560740927579,
    lng: -81.783961193702,
    websiteUrl:
      "https://www.heavytruckparts.net/search.php?fltpc=1586091&store=1",
  },
} as const satisfies HtpSupplier;
