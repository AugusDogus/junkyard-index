export const PULLNSAVE_ORIGIN = "https://app.pullnsaveapp.com";
export const PULLNSAVE_INVENTORY_PAGE_URL =
  "https://www.pullnsave.com/inventory/";

export interface PullNSaveYard {
  yardNumber: number;
  code: string;
  locationName: string;
  city: string;
  state: string;
  stateAbbr: string;
  zipCode: string;
  address: string;
  lat: number;
  lng: number;
}

// Verified metadata retained for existing locations; new IDs are discovered at runtime.
export const PULLNSAVE_YARDS: readonly PullNSaveYard[] = [
  {
    yardNumber: 1,
    code: "PNS-SLC",
    locationName: "Pull N Save - Salt Lake City",
    city: "Salt Lake City",
    state: "Utah",
    stateAbbr: "UT",
    zipCode: "84128",
    address: "6980 W 2100 S",
    lat: 40.72602,
    lng: -112.03428,
  },
  {
    yardNumber: 2,
    code: "PNS-PHX-SOUTH",
    locationName: "Pull N Save - Phoenix South",
    city: "Phoenix",
    state: "Arizona",
    stateAbbr: "AZ",
    zipCode: "85009",
    address: "504 S 27th Ave",
    lat: 33.4432201,
    lng: -112.1194517,
  },
  {
    yardNumber: 3,
    code: "PNS-GLENDALE",
    locationName: "Pull N Save - Glendale",
    city: "Glendale",
    state: "Arizona",
    stateAbbr: "AZ",
    zipCode: "85303",
    address: "6841 W Northern Ave",
    lat: 33.5520903,
    lng: -112.2064802,
  },
  {
    yardNumber: 4,
    code: "PNS-PHX-NORTH",
    locationName: "Pull N Save - Phoenix North",
    city: "Phoenix",
    state: "Arizona",
    stateAbbr: "AZ",
    zipCode: "85009",
    address: "320 S 27th Ave",
    lat: 33.4451272,
    lng: -112.1206582,
  },
  {
    yardNumber: 5,
    code: "PNS-GILBERT",
    locationName: "Pull N Save - Gilbert",
    city: "Gilbert",
    state: "Arizona",
    stateAbbr: "AZ",
    zipCode: "85233",
    address: "623 N Cooper Rd",
    lat: 33.3612596,
    lng: -111.8052413,
  },
  {
    yardNumber: 6,
    code: "PNS-SPRINGVILLE",
    locationName: "Pull N Save - Springville",
    city: "Springville",
    state: "Utah",
    stateAbbr: "UT",
    zipCode: "84663",
    address: "615 W 1600 South",
    lat: 40.1446158,
    lng: -111.6448188,
  },
  {
    yardNumber: 7,
    code: "PNS-TUCSON",
    locationName: "Pull N Save - Tucson",
    city: "Tucson",
    state: "Arizona",
    stateAbbr: "AZ",
    zipCode: "85756",
    address: "6671 E Littletown Rd",
    lat: 32.1341406,
    lng: -110.8529162,
  },
  {
    yardNumber: 9,
    code: "PNS-RIVERSIDE",
    locationName: "Pull N Save - Riverside",
    city: "Riverside",
    state: "California",
    stateAbbr: "CA",
    zipCode: "92507",
    address: "1944 Spruce St",
    lat: 33.9902029,
    lng: -117.3533075,
  },
];
