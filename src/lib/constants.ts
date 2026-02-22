// Algolia
export const ALGOLIA_INDEX_NAME = "vehicles";

// Search configuration
export const SEARCH_CONFIG = {
  DEBOUNCE_DELAY: 300,
} as const;

// API endpoints
export const API_ENDPOINTS = {
  PYP_BASE: "https://www.pyp.com",
  VEHICLE_INVENTORY:
    "/DesktopModules/pyp_vehicleInventory/getVehicleInventory.aspx",
  LOCATION_PAGE: "/inventory/",
  ROW52_BASE: "https://api.row52.com",
  ROW52_VEHICLES: "/odata/Vehicles",
  ROW52_MAKES: "/odata/Makes",
  ROW52_MODELS: "/odata/Models",
  ROW52_LOCATIONS: "/odata/Locations",
  ROW52_CDN: "https://cdn.row52.com",
} as const;

// Error messages
export const ERROR_MESSAGES = {
  SEARCH_FAILED: "Search failed. Please try again.",
} as const;
