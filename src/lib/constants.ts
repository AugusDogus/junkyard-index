// Search configuration
export const SEARCH_CONFIG = {
  DEBOUNCE_DELAY: 300,
  MAX_CONCURRENT_REQUESTS: 5,
  REQUEST_TIMEOUT: 15000,
  REQUEST_DELAY: 500,
  MAX_RETRIES: 3,
  BASE_RETRY_DELAY: 1000,
  MAX_RETRY_DELAY: 10000,
} as const;

// API endpoints
export const API_ENDPOINTS = {
  PYP_BASE: "https://www.pyp.com",
  VEHICLE_INVENTORY:
    "/DesktopModules/pyp_vehicleInventory/getVehicleInventory.aspx",
  LOCATION_PAGE: "/inventory/",
} as const;

// Error messages
export const ERROR_MESSAGES = {
  SEARCH_FAILED: "Search failed. Please try again.",
} as const;
