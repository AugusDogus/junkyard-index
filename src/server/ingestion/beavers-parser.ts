import { z } from "zod";
import {
  beaversClass,
  beaversDocument,
  beaversElements,
  beaversText,
} from "./beavers-html";
import { inventoryHtmlAttribute } from "./inventory-html";
import {
  BEAVERS_ORIGIN,
  beaversDetailUrl,
  beaversDonorId,
  beaversPage,
} from "./beavers-yard-metadata";

const text = z.string().max(500);
export const BeaversRowSchema = z
  .object({
    displayYear: text,
    model: text,
    stock: text,
    vin: text,
    url: z.string().refine((url) => beaversDonorId(url, "route") !== null),
  })
  .strict();
export type BeaversRow = z.infer<typeof BeaversRowSchema>;
export const BeaversCatalogSchema = z
  .object({
    url: z.string().refine((url) => beaversPage(url) !== null),
    page: z.number().int().min(1).max(100),
    total: z.number().int().positive().max(2000),
    next: z.string().nullable(),
    controls: z.array(z.tuple([text, z.string()])).max(8),
    rows: z.array(BeaversRowSchema).min(1).max(20),
  })
  .strict();
export type BeaversCatalog = z.infer<typeof BeaversCatalogSchema>;
export const BeaversRecordSchema = z
  .object({
    row: BeaversRowSchema,
    url: z.string().refine((url) => beaversDonorId(url, "detail") !== null),
    title: text,
    displayYear: text,
    make: text.nullable(),
    model: text,
    vin: text,
    stock: text,
    inactive: z.boolean(),
  })
  .strict();
export type BeaversRecord = z.infer<typeof BeaversRecordSchema>;
function single(html: string, name: string): string {
  const elements = beaversElements(html, name);
  if (elements.length !== 1)
    throw new Error("Beaver's requires exactly one " + name);
  return elements[0]?.body ?? "";
}
export function parseBeaversCatalog(raw: string, url: string): BeaversCatalog {
  const page = beaversPage(url);
  if (page === null) throw new Error("Unowned Beaver's catalog destination");
  const html = beaversDocument(raw);
  const counts = [
    ...beaversText(html).matchAll(/Showing (\d+) Vehicles in Inventory/g),
  ];
  const tables = beaversElements(html, "table").filter(({ tag }) =>
    beaversClass(tag, "table"),
  );
  if (counts.length !== 1 || tables.length !== 1)
    throw new Error("Beaver's roster count/table changed");
  const table = tables[0]?.body ?? "",
    total = Number(counts[0]?.[1]);
  const headers = beaversElements(single(table, "thead"), "th").map(
    ({ body }) => beaversText(body),
  );
  if (
    JSON.stringify(headers) !==
    JSON.stringify([
      "Year",
      "Model",
      "Stock#",
      "Body Style",
      "Mileage",
      "VIN",
      "# Parts",
      "",
    ])
  )
    throw new Error("Beaver's roster columns changed");
  const rows = beaversElements(single(table, "tbody"), "tr").map(({ body }) => {
    const cells = beaversElements(body, "td");
    const links = beaversElements(cells[7]?.body ?? "", "a");
    if (cells.length !== 8 || links.length !== 1)
      throw new Error("Beaver's donor row is incomplete");
    const link = beaversText(
      inventoryHtmlAttribute(links[0]?.tag ?? "", "href") ?? "",
    );
    const values = cells.map(({ body }) => beaversText(body));
    return BeaversRowSchema.parse({
      displayYear: values[0],
      model: values[1],
      stock: values[2],
      vin: values[5],
      url: new URL(link, BEAVERS_ORIGIN).href,
    });
  });
  const foot = single(table, "tfoot");
  if (
    beaversText(foot.replace(/<a\b[^>]*>[\s\S]*?<\/a>/gi, "")) !== String(page)
  )
    throw new Error("Beaver's ignored requested page");
  const controls: [string, string][] = beaversElements(foot, "a").map(
    ({ tag, body }) => [
      beaversText(body),
      new URL(
        beaversText(inventoryHtmlAttribute(tag, "href") ?? ""),
        BEAVERS_ORIGIN,
      ).href,
    ],
  );
  for (const [label, destination] of controls) {
    const number = beaversPage(destination);
    if (
      number === null ||
      number > Math.ceil(total / 20) ||
      (label === ">"
        ? number !== page + 1
        : label === "<"
          ? number !== page - 1
          : label !== String(number))
    )
      throw new Error("Beaver's published pager is inconsistent");
  }
  const next = controls
    .filter(([label]) => label === ">")
    .map(([, href]) => href);
  const lastPage = Math.ceil(total / 20);
  if (
    page > lastPage ||
    rows.length !== Math.min(20, total - (page - 1) * 20) ||
    (page < lastPage ? next.length !== 1 : next.length !== 0) ||
    new Set(rows.map((row) => row.url)).size !== rows.length
  )
    throw new Error(
      "Beaver's roster count, membership or terminal pager does not reconcile",
    );
  return BeaversCatalogSchema.parse({
    url,
    page,
    total,
    rows,
    controls,
    next: next[0] ?? null,
  });
}
export function parseBeaversDetail(
  raw: string,
  row: BeaversRow,
): BeaversRecord {
  BeaversRowSchema.parse(row);
  const html = beaversDocument(raw);
  const headings = beaversElements(html, "h2").map(({ body }) =>
    beaversText(body),
  );
  const titles = headings.filter((title) => !title.startsWith("Search By:"));
  if (
    titles.length !== 1 ||
    headings.length !== 2 ||
    headings[0] !== "Search By: " + titles[0]
  )
    throw new Error("Beaver's primary donor headings conflict");
  const title = titles[0] ?? "",
    parsed = /^('\d{2})\s+(.+)$/.exec(title);
  if (!parsed) throw new Error("Beaver's primary donor heading changed");
  const remainder = parsed[2] ?? "";
  const make = remainder.endsWith(" " + row.model)
    ? remainder.slice(0, -row.model.length).trim()
    : null;
  // A missing make is a required-field reject, not an inferred manufacturer.
  if (remainder !== row.model && !make)
    throw new Error("Beaver's donor title contradicts its native roster model");
  const partRegions = [...html.matchAll(/<div\b[^>]*>/gi)].filter(([tag]) =>
    beaversClass(tag, "optionOneTitle"),
  );
  if (partRegions.length !== 1)
    throw new Error("Beaver's retail-parts boundary changed");
  const primary = html.slice(0, partRegions[0]?.index);
  const fields = beaversElements(primary, "li").map(({ body }) =>
    beaversText(body),
  );
  const values = (prefix: string) =>
    fields
      .filter((field) => field.startsWith(prefix))
      .map((field) => field.slice(prefix.length).trim());
  const vins = values("VIN "),
    stocks = values("Stock# ");
  if (vins.length !== 1 || stocks.length !== 1)
    throw new Error("Beaver's primary VIN/stock region changed");
  return BeaversRecordSchema.parse({
    row,
    url: beaversDetailUrl(row.url),
    title,
    displayYear: parsed[1],
    make,
    model: row.model,
    vin: vins[0],
    stock: stocks[0],
    inactive:
      /\b(?:whole (?:vehicle|donor|car) (?:is )?sold|(?:vehicle|donor|car) (?:has been |is |was )?(?:sold|scrapped|removed))\b/i.test(
        beaversText(primary),
      ),
  });
}
