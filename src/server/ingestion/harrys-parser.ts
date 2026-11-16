import { z } from "zod";
import {
  stripInventoryRawText,
  inventoryHtmlAttribute,
} from "./inventory-html";
import {
  prattElements,
  prattText,
  prattAttribute,
  prattRegion,
  prattContinuation,
} from "./pratt-html";
import {
  HARRYS_ORIGIN,
  HARRYS_PAGE_SIZE,
  HARRYS_MAX_PAGES,
  HARRYS_YARDS,
  harrysPageUrl,
} from "./harrys-yard-metadata";
const text = z.string().max(300);
export const HarrysRecordSchema = z
  .object({
    id: z.string().regex(/^\d+$/),
    yard: text,
    year: text,
    make: text,
    model: text,
    color: text,
    date: text,
    row: text,
    vin: text,
  })
  .strict();
export type HarrysRecord = z.infer<typeof HarrysRecordSchema>;
export const HarrysPageSchema = z
  .object({
    index: z
      .number()
      .int()
      .min(0)
      .max(HARRYS_MAX_PAGES - 1),
    total: z
      .number()
      .int()
      .min(1)
      .max(HARRYS_MAX_PAGES * HARRYS_PAGE_SIZE),
    records: z.array(HarrysRecordSchema).min(1).max(HARRYS_PAGE_SIZE),
  })
  .strict();
export type HarrysPage = z.infer<typeof HarrysPageSchema>;
export function harrysDocument(raw: string): string {
  const html = stripInventoryRawText(raw);
  if (
    new TextEncoder().encode(raw).length > 2 * 1024 * 1024 ||
    [/<html\b/gi, /<body\b/gi, /<\/body\s*>/gi, /<\/html\s*>/gi].some(
      (p) => [...html.matchAll(p)].length !== 1,
    ) ||
    !/<\/body\s*>\s*<\/html\s*>\s*$/i.test(html)
  )
    throw new Error("Harry's native HTML is oversized or incomplete");
  return html;
}
export function parseHarrysOwner(raw: string): void {
  const html = harrysDocument(raw);
  for (const yard of HARRYS_YARDS) {
    const region = prattElements(html, "div", (t) =>
      (prattAttribute(t, "class") ?? "")
        .split(/\s+/)
        .includes("awb-tab-pane-inner"),
    ).filter((v) => prattText(v.body).includes("Our " + yard.city + " Yard"));
    if (
      region.length !== 1 ||
      !prattText(region[0]?.body ?? "").includes(yard.address) ||
      !prattText(region[0]?.body ?? "").includes(yard.city + ", PA") ||
      !prattText(region[0]?.body ?? "")
        .replace(/\D/g, "")
        .includes(yard.phone.replace(/\D/g, ""))
    )
      throw new Error("Harry's physical yard ownership changed: " + yard.code);
  }
}
export function parseHarrysPage(raw: string, index: number): HarrysPage {
  harrysPageUrl(index);
  const html = harrysDocument(raw);
  const selectors = [
    ...html.matchAll(/ng-repeat="row in (\[[^"]+\]) track by \$index"/g),
  ];
  if (
    selectors.length !== 1 ||
    selectors[0]?.[1] !== "['ALL', 'ALLENTOWN', 'PENNSBURG', 'HAZLE TOWNSHIP']"
  )
    throw new Error("Harry's native three-yard inventory selector changed");
  const region = prattRegion(
    html,
    (t) => inventoryHtmlAttribute(t, "id") === "_results",
  );
  const showing = [
    ...prattText(region).matchAll(/Showing (\d+) to (\d+) of (\d+) records/g),
  ];
  const match = showing[0];
  const total = Number(match?.[3]);
  const tables = prattElements(region, "table");
  const table = tables[0];
  if (showing.length !== 1 || !table || tables.length !== 1)
    throw new Error("Harry's complete table or native total is missing");
  const heads = prattElements(table.body, "thead");
  const headers = prattElements(heads[0]?.body ?? "", "th").map((c) =>
    prattText(c.body)
      .replace(/[\u032d\u032c]/g, "")
      .trim(),
  );
  if (
    JSON.stringify(headers) !==
    JSON.stringify([
      "Yard City",
      "Year",
      "Make",
      "Model",
      "Manufacturer",
      "Color",
      "Yard Date",
      "Row",
      "VIN",
      "",
    ])
  )
    throw new Error("Harry's native table columns changed");
  const bodies = prattElements(table.body, "tbody");
  if (bodies.length !== 1)
    throw new Error("Harry's inventory body is missing or ambiguous");
  const rows = prattElements(bodies[0]?.body ?? "", "tr");
  if (rows.length !== [...(bodies[0]?.body ?? "").matchAll(/<tr\b/gi)].length)
    throw new Error("Harry's donor rows are incomplete");
  const records = rows.map((row) => {
    const cells = prattElements(row.body, "td");
    if (cells.length !== 10 || [...row.body.matchAll(/<td\b/gi)].length !== 10)
      throw new Error("Harry's native donor cell structure changed");
    const values = cells.map((c) => prattText(c.body));
    const links = prattElements(cells[9]?.body ?? "", "a").filter(
      (a) => prattText(a.body) === "Info",
    );
    const href = prattAttribute(links[0]?.tag ?? "", "href") ?? "";
    const id = /^\/inventory-item\/item-(\d+)$/.exec(href)?.[1];
    if (links.length !== 1 || !id)
      throw new Error("Harry's donor traversal identity is missing");
    return HarrysRecordSchema.parse({
      id,
      yard: values[0],
      year: values[1],
      make: values[2],
      model: values[3],
      color: values[5],
      date: values[6],
      row: values[7],
      vin: values[8],
    });
  });
  if (
    Number(match?.[1]) !== index * 15 + 1 ||
    Number(match?.[2]) !== Math.min((index + 1) * 15, total) ||
    records.length !== Math.min(15, total - index * 15)
  )
    throw new Error("Harry's native range, rows and total do not reconcile");
  for (const [id, expected] of [
    ["_prev", index > 0 ? index - 1 : null],
    ["_next", (index + 1) * 15 < total ? index + 1 : null],
  ] as const) {
    const links = prattElements(
      region,
      "a",
      (t) => prattAttribute(t, "id") === id,
    );
    if (
      expected === null
        ? links.length !== 0
        : links.length !== 1 ||
          URL.parse(
            prattAttribute(links[0]?.tag ?? "", "href") ?? "",
            HARRYS_ORIGIN,
          )?.href !== harrysPageUrl(expected)
    )
      throw new Error(
        "Harry's native previous/next page changed scope or skipped a page",
      );
  }
  const nativeLinks = prattElements(region, "a").filter((link) =>
    URL.parse(
      prattAttribute(link.tag, "href") ?? "",
      HARRYS_ORIGIN,
    )?.searchParams.has("inv[page]"),
  );
  if (
    prattContinuation(region).length ||
    nativeLinks.some(
      (link) =>
        !["_prev", "_next"].includes(prattAttribute(link.tag, "id") ?? ""),
    )
  )
    throw new Error("Harry's inventory has an unknown native continuation");
  const page = HarrysPageSchema.parse({ index, total, records });
  if (new Set(records.map((r) => r.id)).size !== records.length)
    throw new Error("Harry's page repeats a native donor ID");
  return page;
}
