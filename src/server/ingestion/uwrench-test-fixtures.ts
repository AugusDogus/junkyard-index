import type { UwrenchRecord, UwrenchNativeRow } from "./uwrench-parser";
import {
  UWRENCH_EMBED_URL,
  UWRENCH_INVENTORY_URL,
  UWRENCH_ORIGIN,
  UWRENCH_YARD,
} from "./uwrench-yard-metadata";

function document(content: string, canonical: string) {
  return `<html><head><link rel="canonical" href="${canonical}"></head><body><h1>${UWRENCH_YARD.name}</h1><a href="${UWRENCH_INVENTORY_URL}">Inventory</a><footer>3310 Old Cape Rd, Jackson Missouri 573-987-3322</footer>${content}</body></html>`;
}
export const uwrenchTestOwner = document(
  `All of our vehicles are lifted for convenient, easy access under the vehicle. We pass savings on to you by letting you bring your own tools, and take off your own parts.<script>iframe.src = "${UWRENCH_EMBED_URL}";</script>`,
  UWRENCH_ORIGIN + "/",
);
export const uwrenchTestRecord: UwrenchRecord = {
  stock: "STK000802",
  year: 2004,
  make: "JEEP",
  model: "WRANGLER TJ",
  vin: "1J4FA49S94P785631",
  yardLocation: UWRENCH_YARD.name,
  sourceSystem: "crush",
  demo_offset_seconds: null,
  color: "RED",
  vehicleRow: "1",
  dateAdded: "2018-06-26T14:59:35.830",
  daysInYard: 3059,
  damage_condition: null,
  engine: null,
  fuel_type: null,
  imageUrl: null,
  imageUrls: [],
  transmission: null,
};
export const uwrenchTestRow: UwrenchNativeRow = {
  stock: "STK000802",
  year: 2004,
  sourceYear: "2004",
  make: "JEEP",
  model: "WRANGLER",
  color: "RED",
  engine: "100306. 4.0",
  row: "1",
  sourceSetDate: "06/26/18",
};
const escape = (text: string) =>
  text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
export function uwrenchTestInventory(
  rows: readonly UwrenchNativeRow[] = [uwrenchTestRow],
) {
  return document(
    `<table id="vehicles"><thead><tr>${["Year", "Make", "Model", "Color", "Engine", "Stock#", "Vehicle Row", "Date Set in Yard"].map((text) => `<th>${text}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${[row.sourceYear, row.make, row.model, row.color, row.engine, row.stock, row.row, row.sourceSetDate].map((text) => `<td>${escape(text)}</td>`).join("")}</tr>`).join("")}</tbody></table>`,
    UWRENCH_INVENTORY_URL,
  );
}
export const uwrenchTestConfig = JSON.stringify({
  success: true,
  yard_info: {
    yard_id: "tri_state_u_wrench_and_save",
    yard_name: UWRENCH_YARD.name,
    business_name: UWRENCH_YARD.name,
    multi_location_enabled: false,
    per_location_mode_enabled: false,
    locations: [],
    photos_enabled: false,
    timezone: "America/Chicago",
    features: {
      demo_freshness_enabled: false,
      demo_synthesize_alert_matches: false,
      hide_vehicle_search: false,
      alert_only_mode: false,
    },
    url_settings: { custom_slug: "uwrench" },
  },
});
