import { NVPAP_YARDS, type NvpapYard } from "./nvpap-yard-metadata";
import type { NvpapYardCode } from "./nvpap-cursor";
import type { NvpapRecord } from "./nvpap-parser";

export const nvpapTestRecord: NvpapRecord = {
  make: "CHEVROLET",
  model: "CHEVROLET 10 VAN",
  year: 1981,
  vin: "2GCEG25H8B4121375",
  stock: "L133425",
  color: "Brown",
  row: "Row 119",
  date: "Oct 20, 2026",
  images: ["https://nvpap.com/photos/preview_photos/L133425_left.JPG"],
};
export const nvpapTestYard: NvpapYard = {
  source: "nvpap",
  code: "1074",
  name: NVPAP_YARDS["1074"].name,
  operator: "Nevada Pic-A-Part",
  address: "5100 N. Lamb Blvd. #5",
  city: "North Las Vegas",
  state: "NV",
  postalCode: "89115",
  phone: "+1-702-643-1776",
  email: "info@nvpap.com",
  lat: 36.2527229,
  lng: -115.0794377,
  websiteUrl: "https://nvpap.com/contact.html",
};
export const nvpapTestContext =
  '<html><script type="application/ld+json">' +
  JSON.stringify({
    department: Object.values(NVPAP_YARDS).map((yard) => ({
      telephone: yard.phone,
      address: {
        streetAddress: yard.address,
        addressLocality: yard.city,
        addressRegion: "NV",
        postalCode: yard.postalCode,
        addressCountry: "US",
      },
    })),
  }) +
  "</script></html>";

// `modelCell` overrides the rendered model cell to simulate source mismatches.
export function nvpapTestResponse(
  records: readonly (NvpapRecord & { modelCell?: string })[],
  code: NvpapYardCode,
  omittedFields: readonly ("color" | "row" | "date")[] = [],
) {
  const html =
    '<div class="body-search-results">' +
    (records.length === 0
      ? '<div class="body-search-results__empty">No matching vehicles</div>'
      : '<div class="products-body-search">' +
        records
          .map(
            (r, index) =>
              '<div class="products-body-search__item" id="pt1-row-' +
              index +
              '">' +
              r.images.map((src) => '<img src="' + src + '">').join("") +
              Object.entries({
                year: String(r.year),
                // The source renders an empty model as the make alone.
                model:
                  r.modelCell ??
                  (r.model === "" ? r.make : r.make + " " + r.model),
                row: r.row,
                store: code === "1074" ? "Las Vegas" : "Henderson",
                color: r.color,
                stock: r.stock,
                date: r.date,
              })
                .filter(
                  ([key]) => !omittedFields.some((field) => field === key),
                )
                .map(
                  ([key, value]) =>
                    '<div class="products-body-search__' +
                    key +
                    '">' +
                    value +
                    "</div>",
                )
                .join("") +
              '<button data-pt1-vin="' +
              r.vin +
              '">' +
              r.vin +
              "</button></div>",
          )
          .join("") +
        "</div>") +
    "</div>";
  return (
    String(html.length).padStart(6, "0") +
    "\n" +
    html +
    JSON.stringify({
      search_results: records.map((r) => [
        r.make,
        r.model,
        r.year,
        r.vin,
        22,
        Number(code),
      ]),
    })
  );
}
