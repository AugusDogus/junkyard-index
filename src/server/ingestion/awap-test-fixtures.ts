import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { z } from "zod";

const schema = z.object({
  about: z.string(),
  pages: z.array(z.string()).length(8),
  oracle: z
    .array(
      z.object({
        vin: z.string(),
        yearText: z.string(),
        make: z.string(),
        model: z.string(),
        detailUrl: z.string(),
        nativeColorLabels: z.array(z.string()),
        nativeImageUrl: z.string().nullable(),
      }),
    )
    .length(183),
});
const saved: unknown = JSON.parse(
  gunzipSync(
    readFileSync(
      new URL("./awap-test-fixtures/saved-census.json.gz", import.meta.url),
    ),
  ).toString("utf8"),
);
export const awapSavedCensus = schema.parse(saved);

const origin = "https://www.alwholesaleautoparts.com";
export function awapTestCard(
  id: number,
  options: {
    year?: string;
    make?: string;
    model?: string;
    vin?: string;
    title?: string;
    optional?: string;
  } = {},
): string {
  const year = options.year ?? "2003";
  const make = options.make ?? "Honda";
  const model = options.model ?? "Accord";
  const vin = options.vin ?? "1HGCM82633A" + String(id).padStart(6, "0");
  const query = new URLSearchParams({ vin, year, make, model, sku: "SKU" + id })
    .toString()
    .replace(/&/g, "&amp;");
  return `<article class="awap-cy-card"><div class="awap-cy-card-body"><div class="awap-cy-dismantling">– Dismantling –</div><a class="awap-cy-card-title" href="${origin}/cars-at-yard/test-${id}/">${options.title ?? `${year} ${make} ${model}`}</a>${options.optional ?? ""}<a class="awap-cy-view" href="${origin}/inventory/?vin=${vin}">View Parts for It</a><a class="awap-cy-inquiry" href="${origin}/request-a-part/?${query}">Part Inquiry</a></div></article>`;
}
export function awapTestPage(
  page = 1,
  total = 1,
  cards = [awapTestCard(1)],
): string {
  const pageUrl = (value: number) =>
    origin + "/cars-at-yard/" + (value === 1 ? "" : `page/${value}/`);
  const last = Math.ceil(total / 25);
  return `<html><head><title>Alabama Wholesale Auto Parts</title><link rel="canonical" href="${pageUrl(page)}"></head><body><div class="awap-cy-wrap"><h1 class="awap-cy-title">Cars at Yard – Available Donor Vehicles</h1><p class="awap-cy-subtitle">Select a make, narrow by model, or use the filters below to find donor vehicles currently being dismantled.</p><div class="awap-cy-meta">Showing ${total} donor vehicles .</div><div class="awap-cy-grid">${cards.join("")}</div><div class="awap-cy-pagination">${page > 1 ? `<a class="prev" href="${pageUrl(page - 1)}">Previous</a>` : ""}<span aria-current="page">${page}</span>${page < last ? `<a class="next" href="${pageUrl(page + 1)}">Next</a>` : ""}</div></div></body></html>`;
}
