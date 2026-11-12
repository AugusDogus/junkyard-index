import type { VinplusRecord } from "./vinplus-protocol";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { z } from "zod";
import { PICKERS_APP_URL } from "./pickers-yard-metadata";

export const pickersTestRecord = {
  stock: "STK027498",
  year: 2014,
  make: "FORD",
  model: "FOCUS",
  vin: "1FADP3E23EL378589",
  color: "BLACK",
  vehicleRow: "21",
  dateAdded: "2026-11-10T15:26:31.947",
  yardLocation: "Pickers Texarkana",
  sourceSystem: "crush",
  demo_offset_seconds: null,
  imageUrl: null,
  imageUrls: [],
  engine: null,
  transmission: null,
} as const satisfies VinplusRecord;
export const pickersTestReject = {
  ...pickersTestRecord,
  stock: "STK027187",
  year: 2003,
  make: "BMW",
  model: "3 SERIES",
  vin: "WBAET37483NH",
} as const satisfies VinplusRecord;
export const pickersTestQuarantine = {
  ...pickersTestRecord,
  stock: "STK026921",
  year: 1996,
  make: "HONDA",
  model: "ACCORD",
  vin: "1HGCD5635TA268977",
  vehicleRow: "36",
} as const satisfies VinplusRecord;

const footer =
  "<footer>5512 E 9th Street Texarkana, AR 71854 870-772-1880 " +
  '<a href="' +
  PICKERS_APP_URL +
  '">TEXT ME WHEN MY VEHICLE ARRIVES</a>' +
  '<a href="/Home/PartPrices">Part Prices</a></footer>';
export const pickersTestOwner =
  "<html><body>Pickers Self-Service Auto Parts, maintaining an inventory of more than 500 vehicles, rotating constantly." +
  footer +
  "</body></html>";
export function pickersTestInventory(
  records: readonly VinplusRecord[] = [pickersTestRecord],
  makes: readonly string[] = ["FORD", "BMW"],
) {
  const escape = (value: unknown) =>
    String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll('"', "&quot;");
  return (
    '<html><body><form id="searchinventory" action="/Home/Inventory" method="post">' +
    '<select name="VehicleMake"><option value="">Select Make</option>' +
    makes
      .map((make) => '<option value="' + make + '">' + make + "</option>")
      .join("") +
    '</select><select name="VehicleModel"><option value="">Select Model</option></select>' +
    '<input type="submit" value="SEARCH"></form><table><tr>' +
    [
      "YEAR",
      "MAKE",
      "MODEL",
      "COLOR",
      "REFERENCE",
      "ROW",
      "ARRIVAL DATE",
      "IMAGE",
    ]
      .map((header) => "<th>" + header + "</th>")
      .join("") +
    "</tr>" +
    records
      .map(
        (record) =>
          "<tr>" +
          [
            record.year,
            record.make,
            record.model,
            record.color,
            "L4, 2.0L",
            record.vehicleRow,
            "11/10/2026",
          ]
            .map((value) => "<td>" + escape(value) + "</td>")
            .join("") +
          '<td><a href="../PickersInventoryPhotos/' +
          record.stock +
          '.jpg"><img src="../PickersInventoryPhotos/' +
          record.stock +
          '.jpg"></a></td></tr>',
      )
      .join("") +
    "</table>" +
    footer +
    "<table><tr><td>Hours</td></tr></table></body></html>"
  );
}
export const pickersTestConfig = JSON.stringify({
  success: true,
  yard_info: {
    yard_id: "tri_state_iron_metal",
    resolved_location_id: "pickers_texarkana",
    multi_location_enabled: true,
    per_location_mode_enabled: true,
    features: {
      alert_only_mode: false,
      hide_vehicle_search: false,
      demo_freshness_enabled: false,
      demo_synthesize_alert_matches: false,
    },
    locations: [
      {
        location_id: "pickers_texarkana",
        location_name: "Pickers Texarkana",
        city: "Texarkana ",
        state: "TX",
      },
    ],
  },
});
export function pickersTestSearch(
  records: readonly VinplusRecord[],
  pair = { make: "FORD", model: "FOCUS" },
) {
  return JSON.stringify({
    success: true,
    match_count: records.length,
    matches: records,
    search_criteria: {
      ...pair,
      yard_id: "tri_state_iron_metal",
      year_min: null,
      year_max: null,
    },
  });
}

/** Original public qualification bodies, replayed locally without HTTP. */
export function pickersSavedFixture() {
  const body = z.string().max(4 * 1024 * 1024);
  return z
    .object({
      owner: body,
      app: body,
      inventory: body,
      config: body,
      native: z
        .array(
          z.object({ make: z.string(), opening: body, closing: body }).strict(),
        )
        .max(64),
      queries: z
        .array(
          z
            .object({
              pair: z.object({ make: z.string(), model: z.string() }).strict(),
              body,
            })
            .strict(),
        )
        .max(512),
      firstBookend: body,
      lastBookend: body,
    })
    .strict()
    .parse(
      JSON.parse(
        gunzipSync(
          readFileSync(
            new URL(
              "./pickers-test-fixtures/saved-census.json.gz",
              import.meta.url,
            ),
          ),
        ).toString("utf8"),
      ),
    );
}
