import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { z } from "zod";
import type { VinplusRecord } from "./vinplus-protocol";
import {
  JOLIET_CONTACT_URL,
  JOLIET_EMBED_URL,
  JOLIET_INVENTORY_URL,
} from "./joliet-yard-metadata";

/** Saved 2026-11-15 HTML, analytics and exact F-150 response, plus the
 * STK076107 record extracted from the saved 2013 response into a model envelope.
 * Other API queries were not saved and must be explicitly synthesized by tests.
 */
export function jolietDisagreementFixture() {
  return z
    .object({
      inventory: z.string(),
      analytics: z.string(),
      f150: z.string(),
      sonata: z.string(),
    })
    .parse(
      JSON.parse(
        gunzipSync(
          readFileSync(
            new URL(
              "./joliet-test-fixtures/disagreement.json.gz",
              import.meta.url,
            ),
          ),
        ).toString("utf8"),
      ),
    );
}

const embed = '<script>iframe.src = "' + JOLIET_EMBED_URL + '";</script>';
const owner =
  '<footer>Joliet U-Pull-It 1014 E. Washington Street Joliet, IL 60433 <a href="tel:8157233011">(815) 723-3011</a>' +
  '<a href="' +
  JOLIET_INVENTORY_URL +
  '">Vehicle Inventory</a>' +
  '<a href="' +
  JOLIET_CONTACT_URL +
  '">Contact Us</a></footer>';
const copiedMetadata =
  '<script type="application/ld+json">{"@type":"AutoPartsStore","name":"Littleton U-Pull-It","address":{"addressLocality":"Littleton","addressRegion":"CO"}}</script>';
export const jolietTestOwner =
  "<html><body>Our entire inventory is placed on stands for the convenience of our customer, so all you have to do is bring your own tools and pull the parts you need." +
  copiedMetadata +
  owner +
  embed +
  "</body></html>";
export const jolietTestContact =
  "<html><body>" + owner + embed + "</body></html>";
export const jolietTestRecord = {
  stock: "STK075102",
  year: 2014,
  make: "FORD",
  model: "TAURUS",
  vin: "1FAHP2J89EG117594",
  yardLocation: "Joliet U-Pull-It",
  sourceSystem: "crush",
  demo_offset_seconds: null,
  color: null,
  vehicleRow: "99",
  dateAdded: "2026-08-19T09:00:18.943",
  imageUrl: null,
  imageUrls: [],
} as const satisfies VinplusRecord;

export const jolietTestConfig = JSON.stringify({
  success: true,
  yard_info: {
    yard_id: "joliet_u_pull_it",
    yard_name: "Joliet U-Pull-It",
    business_name: "Joliet U-Pull-It",
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
      store_phone: "(815) 723-3011",
    },
    url_settings: { custom_slug: "joliet" },
  },
});

export function jolietTestInventory(
  records: readonly VinplusRecord[] = [jolietTestRecord],
): string {
  const escape = (value: unknown) =>
    typeof value === "string"
      ? value.replaceAll("&", "&amp;").replaceAll("<", "&lt;")
      : String(value ?? "");
  return (
    "<html><body><h1>Littleton U-Pull-It Vehicle Inventory</h1>" +
    owner +
    embed +
    '<table class="table table-parts text-center"><thead><tr>' +
    ["Year", "Make", "Model", "Stock#", "Vehicle Row", "Date Set in Yard"]
      .map((value) => "<th>" + value + "</th>")
      .join("") +
    "</tr></thead><tbody>" +
    records
      .map(
        (record) =>
          "<tr>" +
          [
            record.year,
            record.make,
            record.model,
            record.stock,
            record.vehicleRow,
            "08.19.26",
          ]
            .map((value) => "<td>" + escape(value) + "</td>")
            .join("") +
          "</tr>",
      )
      .join("") +
    "</tbody></table></body></html>"
  );
}

export function jolietTestAnalytics(
  records: readonly VinplusRecord[] = [jolietTestRecord],
): string {
  const years = new Map<number, number>();
  for (const record of records)
    years.set(record.year, (years.get(record.year) ?? 0) + 1);
  return JSON.stringify({
    success: true,
    data: {
      current_count: records.length,
      by_year: [...years].map(([year, count]) => ({
        year: String(year),
        count,
      })),
    },
  });
}

export function jolietTestSearch(
  records: readonly VinplusRecord[] = [jolietTestRecord],
  pair = { make: "FORD", model: "TAURUS" },
): string {
  return JSON.stringify({
    success: true,
    match_count: records.length,
    matches: records,
    search_criteria: {
      ...pair,
      yard_id: "joliet_u_pull_it",
      year_min: null,
      year_max: null,
    },
  });
}
