import type { PipesNativeRow, PipesRecord } from "./pipes-parser";

const nativeOwner = `<p>806 Aero Drive Shreveport, LA 71107</p><a href="tel:318-222-9547">318-222-9547</a><a href="/Home/Inventory">Inventory</a>`;
export const pipesTestOwner = `<html><body>${nativeOwner}<p>Self-Service Auto Parts Store. Bring your tools to Pipes U-Pull-It. Pipes is not affiliated with U Auto Pull It Auto Parts.</p></body></html>`;
export const pipesTestDirections = `<html><body>${nativeOwner}<p>Self-Service Auto Parts 318-222-2277</p></body></html>`;
export const pipesTestNative: PipesNativeRow = {
  rawYear: "2010",
  year: 2010,
  make: "FORD",
  model: "FOCUS",
  color: "WHITE",
  reference: "L4, 2.0L",
  row: "12",
  arrivalDate: "11/03/2026",
  stock: "STK041000",
  photos: ["https://www.pipesupullit.net/PipesPhotos/STK041000.jpg"],
  images: ["https://www.pipesupullit.net/PipesPhotos/STK041000.jpg"],
};
export const pipesTestRecord: PipesRecord = {
  stock: "STK041000",
  year: 2010,
  vin: "1FAHP3FN0AW123456",
  make: "FORD",
  model: "FOCUS",
  color: "WHITE",
  vehicleRow: "12",
  dateAdded: "2026-11-03T11:04:21.397",
  daysInYard: 7,
  sourceSystem: "crush",
  yardLocation: "Pipes Shreveport",
  engine: null,
  imageUrl: null,
  imageUrls: [],
};
export function pipesTestInventory(
  rows: readonly PipesNativeRow[] = [pipesTestNative],
  makes: readonly string[] = ["FORD"],
) {
  const headings = [
    "YEAR",
    "MAKE",
    "MODEL",
    "COLOR",
    "REFERENCE",
    "ROW",
    "ARRIVAL DATE",
    "PHOTO",
  ];
  return `<html><body>${nativeOwner}<form id="searchinventory" action="/Home/Inventory" method="post"><select name="VehicleMake"><option value="">Select Make</option>${makes.map((make) => `<option value="${make}">${make}</option>`).join("")}</select><select name="VehicleModel"><option value="">Select Model</option></select></form><table><tr>${headings.map((h) => `<th>${h}</th>`).join("")}</tr>${rows.map((row) => `<tr>${[row.rawYear, row.make, row.model, row.color ?? "", row.reference ?? "", row.row ?? "", row.arrivalDate ?? "", row.photos.map((photo) => `<a href="${photo}"><img src="${photo}"></a>`).join("")].map((value) => `<td>${value}</td>`).join("")}</tr>`).join("")}</table><a href="https://vinplus.texnrewards.com/parts/pipes-shreveport">Alerts</a></body></html>`;
}
export const pipesTestConfig = JSON.stringify({
  success: true,
  yard_info: {
    yard_id: "tri_state_iron_metal",
    business_name: "Tri-State Iron & Metal",
    yard_name: "Tri-State Iron & Metal",
    resolved_location_id: "pipes_shreveport",
    multi_location_enabled: true,
    per_location_mode_enabled: true,
    timezone: "America/Chicago",
    photos_enabled: false,
    locations: [
      {
        location_id: "pipes_shreveport",
        location_name: "Pipes Shreveport",
        city: "Shreveport",
        state: "LA",
      },
    ],
    features: {
      demo_freshness_enabled: false,
      demo_synthesize_alert_matches: false,
      hide_vehicle_search: false,
      alert_only_mode: false,
    },
    url_settings: {
      flat_location_slugs: { "pipes-shreveport": "pipes_shreveport" },
    },
  },
});
export function pipesTestSearch(
  records: readonly PipesRecord[] = [pipesTestRecord],
  pair = { make: "FORD", model: "FOCUS" },
) {
  return JSON.stringify({
    success: true,
    match_count: records.length,
    matches: records,
    search_criteria: {
      yard_id: "tri_state_iron_metal",
      year_min: null,
      year_max: null,
      make: pair.make,
      model: pair.model,
    },
  });
}
