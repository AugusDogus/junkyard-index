import type { Yard } from "~/lib/yard";

export const PICKERS_ORIGIN = "https://pickerstxk.com";
export const PICKERS_INVENTORY_URL = PICKERS_ORIGIN + "/Home/Inventory";
export const PICKERS_PRICES_URL = PICKERS_ORIGIN + "/Home/PartPrices";
export const PICKERS_APP_URL =
  "https://vinplus.texnrewards.com/parts/pickers-texarkana";
const api = "https://inventory-search-api-581547763015.us-central1.run.app";
export const PICKERS_CONFIG_URL = api + "/api/yard-info/pickers_texarkana";
export const PICKERS_SEARCH_URL = api + "/searchVehicleHttp";
export const PICKERS_OPERATOR_ID = "tri_state_iron_metal";
export const PICKERS_LOCATION_ID = "pickers_texarkana";

// Native address/phone establish Arkansas despite vendor location state TX.
// ASYD's address-bound business point agrees with the named AutoRecycler
// Texarkana point within 7.402 m. Neither Google's viewport nor the copied
// AutoRecycler Longview address supplies this yard's geography.
export const PICKERS_YARD = {
  source: "pickers",
  code: "pickers-texarkana",
  name: "Pickers Self-Service Auto Parts",
  operator: "Tri-State Iron & Metal",
  address: "5512 E 9th Street",
  city: "Texarkana",
  state: "AR",
  postalCode: "71854",
  phone: "870-772-1880",
  email: null,
  lat: 33.42952,
  lng: -93.97398,
  websiteUrl: PICKERS_INVENTORY_URL,
} as const satisfies Yard;
export type PickersYard = PickersSite["yard"];

export interface PickersSite {
  code: "pickers-texarkana" | "pickers-longview" | "pickers-reno";
  origin: string;
  appUrl: string;
  configUrl: string;
  locationId: string;
  vendorName: string;
  photoDirectory: string;
  yard: Yard & {
    address: string;
    phone: string;
    postalCode: string;
    lat: number;
    lng: number;
  };
  stateName: string;
  headers: readonly string[];
  activeStatement: string;
}

const defaultHeaders = [
  "YEAR",
  "MAKE",
  "MODEL",
  "COLOR",
  "REFERENCE",
  "ROW",
  "ARRIVAL DATE",
  "IMAGE",
] as const;
// TX points are Census exact-address street-range interpolation, not rooftop pins.
// Saved geocodes: .scratchpad/provider-coverage/nov14-provider-goal/pickers-expansion/.
// The coverage connector traverses these admitted physical yards in order.
export const PICKERS_SITES = {
  "pickers-texarkana": {
    code: "pickers-texarkana",
    origin: PICKERS_ORIGIN,
    appUrl: PICKERS_APP_URL,
    configUrl: PICKERS_CONFIG_URL,
    locationId: PICKERS_LOCATION_ID,
    vendorName: "Pickers Texarkana",
    photoDirectory: "PickersInventoryPhotos",
    yard: PICKERS_YARD,
    stateName: "Arkansas",
    headers: defaultHeaders,
    activeStatement:
      "maintaining an inventory of more than 500 vehicles, rotating constantly.",
  },
  "pickers-longview": {
    code: "pickers-longview",
    origin: "https://pickerslongview.com",
    appUrl: "https://vinplus.texnrewards.com/parts/pickers-longview",
    configUrl: api + "/api/yard-info/pickers_longview",
    locationId: "pickers_longview",
    activeStatement:
      "Joe Boys U-Pull-It auto parts facility in Longview, TX is now Pickers Self-Service Auto Parts.",
    vendorName: "Pickers Longview",
    photoDirectory: "PickersLongviewPhotos",
    yard: {
      source: "pickers",
      code: "pickers-longview",
      name: "Pickers Self-Service Auto Parts Longview",
      operator: "Tri-State Iron & Metal",
      address: "5910 W Marshall Ave",
      city: "Longview",
      state: "TX",
      postalCode: "75604",
      phone: "903-459-4470",
      email: null,
      lat: 32.512129240164,
      lng: -94.829516480918,
      websiteUrl: "https://pickerslongview.com/Home/Inventory",
    },
    stateName: "Texas",
    headers: [
      "YEAR",
      "MAKE",
      "MODEL",
      "REF",
      "COLOR",
      "ROW",
      "ARRIVAL DATE",
      "IMAGE",
    ],
  },
  "pickers-reno": {
    code: "pickers-reno",
    origin: "https://pickersreno.com",
    appUrl: "https://vinplus.texnrewards.com/parts/pickers-reno",
    configUrl: api + "/api/yard-info/pickers_reno",
    locationId: "pickers_reno",
    activeStatement:
      'The "You-Pull-It" auto parts facility at Pickers maintains an inventory of more than 500 vehicles, rotating constantly.',
    vendorName: "Pickers Reno",
    photoDirectory: "PickersRenoInventoryPhotos",
    yard: {
      source: "pickers",
      code: "pickers-reno",
      name: "Pickers Self-Service Auto Parts Reno",
      operator: "Tri-State Iron & Metal",
      address: "7090 Lamar Rd",
      city: "Reno",
      state: "TX",
      postalCode: "75462",
      phone: "888-402-3829",
      email: null,
      lat: 33.663280126385,
      lng: -95.454935610305,
      websiteUrl: "https://pickersreno.com/Home/Inventory",
    },
    stateName: "Texas",
    headers: [
      "YEAR",
      "MAKE",
      "MODEL",
      "COLOR",
      "REFERENCE",
      "ROW",
      "ARRIVAL DATE",
      "PHOTO",
    ],
  },
} as const satisfies Record<string, PickersSite>;
export const PICKERS_DEFAULT_SITE: PickersSite =
  PICKERS_SITES["pickers-texarkana"];
