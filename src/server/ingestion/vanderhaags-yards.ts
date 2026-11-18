import type { Yard } from "~/lib/yard";

// Official locations map and complete donor catalog, verified 2026-11-18.
export const VANDERHAAGS_YARDS = [
  {
    catalogLabel: "Sioux Falls, SD",
    store: "Sioux Falls",
    minimumInventory: 95,
    yard: {
      source: "vanderhaags",
      code: "sioux-falls",
      name: "Vander Haag's Sioux Falls",
      operator: "Vander Haag's",
      address: "1423 E 54th St N",
      city: "Sioux Falls",
      state: "SD",
      postalCode: "57104",
      phone: "888-386-5030",
      email: null,
      lat: 43.594099,
      lng: -96.70945,
      websiteUrl:
        "https://www.vanderhaags.com/locationtemplate.php?store=Sioux%20Falls",
    },
  },
  {
    catalogLabel: "Spencer, IA",
    store: "Spencer",
    minimumInventory: 46,
    yard: {
      source: "vanderhaags",
      code: "spencer",
      name: "Vander Haag's Spencer",
      operator: "Vander Haag's",
      address: "3809 4th Ave W",
      city: "Spencer",
      state: "IA",
      postalCode: "51301",
      phone: "877-242-5030",
      email: null,
      lat: 43.178044,
      lng: -95.155024,
      websiteUrl:
        "https://www.vanderhaags.com/locationtemplate.php?store=Spencer",
    },
  },
  {
    catalogLabel: "Des Moines, IA",
    store: "Des Moines",
    minimumInventory: 77,
    yard: {
      source: "vanderhaags",
      code: "des-moines",
      name: "Vander Haag's Des Moines",
      operator: "Vander Haag's",
      address: "4444 Delaware Ave",
      city: "Des Moines",
      state: "IA",
      postalCode: "50313",
      phone: "866-675-5164",
      email: null,
      lat: 41.640436,
      lng: -93.584249,
      websiteUrl:
        "https://www.vanderhaags.com/locationtemplate.php?store=Des%20Moines",
    },
  },
  {
    catalogLabel: "Council Bluffs, IA",
    store: "Council Bluffs",
    minimumInventory: 113,
    yard: {
      source: "vanderhaags",
      code: "council-bluffs",
      name: "Vander Haag's Council Bluffs",
      operator: "Vander Haag's",
      address: "50200 189th St",
      city: "Council Bluffs",
      state: "IA",
      postalCode: "51503",
      phone: "866-673-5030",
      email: null,
      lat: 41.158006,
      lng: -95.826804,
      websiteUrl:
        "https://www.vanderhaags.com/locationtemplate.php?store=Council%20Bluffs",
    },
  },
  {
    catalogLabel: "Kansas City, MO",
    store: "Kansas City",
    minimumInventory: 94,
    yard: {
      source: "vanderhaags",
      code: "kansas-city",
      name: "Vander Haag's Kansas City",
      operator: "Vander Haag's",
      address: "7501 E US Hwy 40",
      city: "Kansas City",
      state: "MO",
      postalCode: "64129",
      phone: "866-677-5164",
      email: null,
      lat: 39.065417,
      lng: -94.498172,
      websiteUrl:
        "https://www.vanderhaags.com/locationtemplate.php?store=Kansas%20City",
    },
  },
  {
    catalogLabel: "Winamac, IN",
    store: "Winamac",
    minimumInventory: 178,
    yard: {
      source: "vanderhaags",
      code: "winamac",
      name: "Vander Haag's Winamac",
      operator: "Vander Haag's",
      address: "495 E 150 S",
      city: "Winamac",
      state: "IN",
      postalCode: "46996",
      phone: "866-465-5030",
      email: null,
      lat: 41.033283,
      lng: -86.596167,
      websiteUrl:
        "https://www.vanderhaags.com/locationtemplate.php?store=Winamac",
    },
  },
  {
    catalogLabel: "London, OH",
    store: "Columbus",
    minimumInventory: 100,
    yard: {
      source: "vanderhaags",
      code: "london",
      name: "Vander Haag's Columbus",
      operator: "Vander Haag's",
      address: "1499 Highway 42 NE",
      city: "London",
      state: "OH",
      postalCode: "43140",
      phone: "833-619-0820",
      email: null,
      lat: 39.960151,
      lng: -83.3667,
      websiteUrl:
        "https://www.vanderhaags.com/locationtemplate.php?store=Columbus",
    },
  },
] as const satisfies readonly {
  catalogLabel: string;
  store: string;
  minimumInventory: number;
  yard: Yard;
}[];

export const VANDERHAAGS_YARD = VANDERHAAGS_YARDS[0].yard;
export const VANDERHAAGS_MINIMUM_BY_YARD = new Map(
  VANDERHAAGS_YARDS.map((y) => [y.yard.code, y.minimumInventory]),
);
export const VANDERHAAGS_MINIMUM = VANDERHAAGS_YARDS.reduce(
  (total, yard) => total + yard.minimumInventory,
  0,
);

export type VanderHaagsYard = (typeof VANDERHAAGS_YARDS)[number];
