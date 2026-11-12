import type { LittletonRecord } from "./littleton-parser";
import {
  LITTLETON_EMBED_URL,
  LITTLETON_INVENTORY_URL,
  LITTLETON_ORIGIN,
  LITTLETON_YARD,
} from "./littleton-yard-metadata";

const embed = '<script>iframe.src = "' + LITTLETON_EMBED_URL + '";</script>';
export const littletonTestOwner =
  "<html><body>8571 US Hwy. 85 N Littleton, CO 80125 (303) 791-1380 Our entire inventory is placed on stands for the convenience of our customer, so all you have to do is bring your own tools and pull the parts you need." +
  embed +
  "</body></html>";
export const littletonTestRecord = {
  stock: "STK056374",
  year: 2005,
  make: "ACURA",
  model: "MDX",
  vin: "2HNYD18845H540309",
  yardLocation: "Littleton U-Pull-It",
  sourceSystem: "crush",
  demo_offset_seconds: null,
  color: "BLACK",
  vehicleRow: "35",
  dateAdded: "2026-11-04T11:45:31.863",
  imageUrl: null,
  imageUrls: [],
} as const satisfies LittletonRecord;
export const littletonTestConfig = JSON.stringify({
  success: true,
  yard_info: {
    yard_id: "littleton_u_pull_it",
    yard_name: LITTLETON_YARD.name,
    business_name: LITTLETON_YARD.name,
    multi_location_enabled: false,
    per_location_mode_enabled: false,
    locations: [],
    photos_enabled: false,
    timezone: "America/Denver",
    features: {
      demo_freshness_enabled: false,
      demo_synthesize_alert_matches: false,
      hide_vehicle_search: false,
      alert_only_mode: false,
      store_phone: "(303) 791-1380",
    },
    url_settings: { custom_slug: "littleton" },
  },
});
export function littletonTestInventory(
  records: readonly LittletonRecord[] = [littletonTestRecord],
): string {
  const collection = {
    "@type": "CollectionPage",
    url: LITTLETON_INVENTORY_URL,
    description: "Inventory is updated daily.",
    mainEntity: {
      "@type": "ItemList",
      description: "Used vehicle inventory updated daily.",
    },
    provider: {
      "@type": "AutoPartsStore",
      name: LITTLETON_YARD.name,
      url: LITTLETON_ORIGIN + "/",
      address: {
        streetAddress: LITTLETON_YARD.address,
        addressLocality: "Littleton",
        addressRegion: "CO",
        postalCode: "80125",
        addressCountry: "US",
      },
    },
  };
  const escape = (value: unknown) =>
    typeof value === "string"
      ? value.replaceAll("&", "&amp;").replaceAll("<", "&lt;")
      : String(value ?? "");
  return (
    '<html><body><script type="application/ld+json">' +
    JSON.stringify(collection) +
    "</script>" +
    embed +
    '<table class="table table-parts text-center"><thead><tr>' +
    ["Year", "Make", "Model", "Stock#", "Vehicle Row", "Date Set in Yard"]
      .map((v) => "<th>" + v + "</th>")
      .join("") +
    "</tr></thead><tbody>" +
    records
      .map(
        (r) =>
          "<tr>" +
          [r.year, r.make, r.model, r.stock, r.vehicleRow, "11.04.26"]
            .map((v) => "<td>" + escape(v) + "</td>")
            .join("") +
          "</tr>",
      )
      .join("") +
    "</tbody></table></body></html>"
  );
}
export function littletonTestAnalytics(
  records: readonly LittletonRecord[] = [littletonTestRecord],
): string {
  const years = new Map<number, number>();
  for (const record of records)
    years.set(record.year, (years.get(record.year) ?? 0) + 1);
  return JSON.stringify({
    data: {
      by_year: [...years].map(([year, count]) => ({
        year: String(year),
        count,
      })),
      current_count: records.length,
    },
    success: true,
  });
}
export function littletonTestSearch(
  records: readonly LittletonRecord[] = [littletonTestRecord],
  pair = { make: "ACURA", model: "MDX" },
): string {
  return JSON.stringify({
    success: true,
    match_count: records.length,
    matches: records,
    search_criteria: {
      make: pair.make,
      model: pair.model,
      yard_id: "littleton_u_pull_it",
      year_min: null,
      year_max: null,
    },
  });
}
