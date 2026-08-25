// Algolia
export const ALGOLIA_INDEX_NAME = "vehicles";
export const ALGOLIA_PAGINATION_LIMIT = 10000;
export const ALGOLIA_REPLICA_INDEX_NAMES = [
  "vehicles_oldest",
  "vehicles_year_desc",
  "vehicles_year_asc",
  "vehicles_distance",
] as const;
export const ALGOLIA_SEARCH_INDEX_NAMES = [
  ALGOLIA_INDEX_NAME,
  ...ALGOLIA_REPLICA_INDEX_NAMES,
] as const;
export type AlgoliaSearchIndexName =
  (typeof ALGOLIA_SEARCH_INDEX_NAMES)[number];

// Search configuration
export const SEARCH_CONFIG = {
  DEBOUNCE_DELAY: 300,
  ANONYMOUS_VISIBLE_RESULTS_LIMIT: 6,
} as const;

// Growth / monetization configuration
export const MONETIZATION_CONFIG = {
  ANONYMOUS_VISIBLE_RESULTS_LIMIT: 6,
} as const;

// API endpoints
export const API_ENDPOINTS = {
  PYP_BASE: "https://www.pyp.com",
  VEHICLE_INVENTORY:
    "/DesktopModules/pyp_vehicleInventory/getVehicleInventory.aspx",
  LOCATION_PAGE: "/inventory/",
  PULLAPART_WEB: "https://www.pullapart.com",
  UPULLANDPAY_WEB: "https://www.upullandpay.com",
  PULLAPART_INVENTORY_BASE: "https://inventoryservice.pullapart.com",
  PULLAPART_ENTERPRISE_BASE: "https://enterpriseservice.pullapart.com",
  PULLAPART_EXTERNAL_INTERCHANGE_BASE:
    "https://externalinterchangeservice.pullapart.com",
  ROW52_BASE: "https://api.row52.com",
  ROW52_WEB: "https://row52.com",
  PYP_FILTER_INVENTORY: "/DesktopModules/pyp_api/api/Inventory/Filter",
  ROW52_VEHICLES: "/odata/Vehicles",
  ROW52_MAKES: "/odata/Makes",
  ROW52_MODELS: "/odata/Models",
  ROW52_LOCATIONS: "/odata/Locations",
  ROW52_LOCATION_SEARCH:
    "/odata/Locations/Row52.Search(postalCode='null', distance=0)",
  ROW52_CDN: "https://cdn.row52.com",
} as const;

// Error messages
export const ERROR_MESSAGES = {
  SEARCH_FAILED: "Search failed. Please try again.",
} as const;
