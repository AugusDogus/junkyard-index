import type { Yard } from "~/lib/yard";

/** BYOT-published GeoCoordinates, checked against each location's city and address. */
export const BYOT_YARDS = [
  {
    source: "byot",
    code: "1123",
    name: "BYOT Auto Parts Waco",
    operator: "BYOT Auto Parts",
    address: "14401 N. Interstate 35 Frontage Rd",
    city: "Elm Mott",
    state: "TX",
    postalCode: "76640",
    phone: null,
    email: null,
    lat: 31.6934,
    lng: -97.10259,
    websiteUrl: "https://www.byotautoparts.com/locations/waco/",
    inventoryUrl: "https://www.byotautoparts.com/locations/waco/inventory/",
    stockPrefix: "STK",
    minimumInventory: 428,
    stateName: "Texas",
    coordinateSource:
      "https://www.byotautoparts.com/locations/waco/ (published GeoCoordinates)",
  },
  {
    source: "byot",
    code: "1183",
    name: "BYOT Auto Parts Bryan",
    operator: "BYOT Auto Parts",
    address: "3738 E State Hwy 21",
    city: "Bryan",
    state: "TX",
    postalCode: "77808",
    phone: null,
    email: null,
    lat: 30.70017,
    lng: -96.35607,
    websiteUrl:
      "https://www.byotautoparts.com/locations/bryan-college-station/",
    inventoryUrl:
      "https://www.byotautoparts.com/locations/bryan-college-station/inventory/",
    stockPrefix: "BCS",
    minimumInventory: 322,
    stateName: "Texas",
    coordinateSource:
      "https://www.byotautoparts.com/locations/bryan-college-station/ (published GeoCoordinates)",
  },
  {
    source: "byot",
    code: "1218",
    name: "BYOT Auto Parts Beaumont",
    operator: "BYOT Auto Parts",
    address: "7516 Shady Ln",
    city: "Beaumont",
    state: "TX",
    postalCode: "77713",
    phone: null,
    email: null,
    lat: 30.058371,
    lng: -94.218987,
    websiteUrl: "https://www.byotautoparts.com/locations/beaumont/",
    inventoryUrl: "https://www.byotautoparts.com/locations/beaumont/inventory/",
    stockPrefix: "BMT",
    minimumInventory: 357,
    stateName: "Texas",
    coordinateSource:
      "https://www.byotautoparts.com/locations/beaumont/ (published GeoCoordinates)",
  },
  {
    source: "byot",
    code: "1259",
    name: "BYOT Auto Parts Port Allen",
    operator: "BYOT Auto Parts",
    address: "4007 I-10 Frontage Rd",
    city: "Port Allen",
    state: "LA",
    postalCode: "70767",
    phone: null,
    email: null,
    lat: 30.45223,
    lng: -91.28975,
    websiteUrl: "https://www.byotautoparts.com/locations/baton-rouge/",
    inventoryUrl:
      "https://www.byotautoparts.com/locations/baton-rouge/inventory/",
    stockPrefix: "BTR",
    minimumInventory: 345,
    stateName: "Louisiana",
    coordinateSource:
      "https://www.byotautoparts.com/locations/baton-rouge/ (published GeoCoordinates)",
  },
  {
    source: "byot",
    code: "1289",
    name: "BYOT Auto Parts Jackson",
    operator: "BYOT Auto Parts",
    address: "908 S Roach St",
    city: "Jackson",
    state: "MS",
    postalCode: "39201",
    phone: null,
    email: null,
    lat: 32.287203,
    lng: -90.188693,
    websiteUrl: "https://www.byotautoparts.com/locations/jackson/",
    inventoryUrl:
      "https://www.byotautoparts.com/locations/jackson-ms/inventory/",
    stockPrefix: "JMS",
    minimumInventory: 323,
    stateName: "Mississippi",
    coordinateSource:
      "https://www.byotautoparts.com/locations/jackson/ (published GeoCoordinates)",
  },
] as const satisfies readonly (Yard & {
  inventoryUrl: string;
  stockPrefix: string;
  minimumInventory: number;
  stateName: string;
  coordinateSource: string;
})[];
export type ByotYard = (typeof BYOT_YARDS)[number];
