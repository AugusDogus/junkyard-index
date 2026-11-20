import { AlgoliaDeployment } from "~/lib/algolia-deployment";

// Algolia
// next.config.js inlines NEXT_PUBLIC_VERCEL_ENV for the browser; the server
// also reads VERCEL_ENV, so both name the same indices.
const ALGOLIA_DEPLOYMENT = AlgoliaDeployment.parse(
  process.env.NEXT_PUBLIC_VERCEL_ENV || process.env.VERCEL_ENV,
);
const algoliaIndexName = (baseName: string) =>
  AlgoliaDeployment.indexName(ALGOLIA_DEPLOYMENT, baseName);
/** "vehicles" in production; Vercel previews use "preview_vehicles". */
export const ALGOLIA_INDEX_NAME = algoliaIndexName("vehicles");
export const ALGOLIA_PAGINATION_LIMIT = 10000;
// UI/saved-search alias only. Requests use the primary index, not a replica.
export const ALGOLIA_DISTANCE_SORT_ALIAS = "vehicles_distance";
export const ALGOLIA_REPLICA_INDEX_NAMES = [
  algoliaIndexName("vehicles_oldest"),
  algoliaIndexName("vehicles_year_desc"),
  algoliaIndexName("vehicles_year_asc"),
  algoliaIndexName("vehicles_newest"),
] as const;
export const ALGOLIA_SEARCH_INDEX_NAMES = [
  ALGOLIA_INDEX_NAME,
  ...ALGOLIA_REPLICA_INDEX_NAMES,
] as const;
export type AlgoliaSearchIndexName =
  (typeof ALGOLIA_SEARCH_INDEX_NAMES)[number];

export const ALGOLIA_NEWEST_INDEX_NAME = ALGOLIA_REPLICA_INDEX_NAMES[3];

// Search configuration
export const SEARCH_CONFIG = {
  DEBOUNCE_DELAY: 300,
  // Visitors and free accounts see one page of results; paid plans see all.
  FREE_VISIBLE_RESULTS_LIMIT: 24,
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
