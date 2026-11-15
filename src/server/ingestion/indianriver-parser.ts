import { createHash } from "node:crypto";
import { z } from "zod";
import {
  inventoryHtmlAttribute,
  inventoryTableSections,
  stripInventoryRawText,
} from "./inventory-html";
import { prattContinuation, prattElements, prattText } from "./pratt-html";
import {
  INDIANRIVER_CATALOG,
  INDIANRIVER_MAX_PAGES,
  INDIANRIVER_ORIGIN,
  INDIANRIVER_PAGE_SIZE,
  INDIANRIVER_YARD,
  indianriverPageUrl,
} from "./indianriver-yard-metadata";

export const indianriverHash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const text = z.string().max(2000);
export const IndianriverRecordSchema = z
  .object({
    id: z.string().regex(/^\d+$/),
    year: text,
    make: text,
    model: text,
    vin: text,
    reference: text,
    arrivalDate: text,
    paperwork: text,
  })
  .strict();
export type IndianriverRecord = z.infer<typeof IndianriverRecordSchema>;
export const IndianriverPageSchema = z
  .object({
    index: z
      .number()
      .int()
      .min(0)
      .max(INDIANRIVER_MAX_PAGES - 1),
    total: z
      .number()
      .int()
      .positive()
      .max(INDIANRIVER_PAGE_SIZE * INDIANRIVER_MAX_PAGES),
    records: z.array(IndianriverRecordSchema).min(1).max(INDIANRIVER_PAGE_SIZE),
  })
  .strict();
export type IndianriverPage = z.infer<typeof IndianriverPageSchema>;
const attr = (tag: string, key: string) =>
  prattText(inventoryHtmlAttribute(tag, key) ?? "");
const hasClass = (tag: string, name: string) =>
  attr(tag, "class").split(/\s+/).includes(name);

function document(raw: string): string {
  const html = stripInventoryRawText(raw);
  if (
    Buffer.byteLength(raw) > 2 * 1024 * 1024 ||
    [/<html\b/gi, /<body\b/gi, /<\/body\s*>/gi, /<\/html\s*>/gi].some(
      (p) => [...html.matchAll(p)].length !== 1,
    ) ||
    !/<\/body\s*>\s*<\/html\s*>\s*$/i.test(html)
  )
    throw new Error("Indian River native document is oversized or incomplete");
  return html;
}

export function parseIndianriverOwner(raw: string): string {
  const html = document(raw),
    body = prattText(html);
  if (
    ![
      INDIANRIVER_YARD.name,
      "4600 45th St, Vero Beach, Florida 32967",
      "(772) 569-1563",
      "Visit the auto salvage yard of Indian River U-Pull-It",
      "Inventory",
    ].every((v) => body.includes(v))
  )
    throw new Error(
      "Indian River owned-yard inventory, physical address or phone changed",
    );
  if (
    !prattElements(html, "a").some(
      (a) =>
        attr(a.tag, "href") === INDIANRIVER_CATALOG &&
        prattText(a.body) === "Inventory",
    )
  )
    throw new Error("Indian River native inventory destination changed");
  return indianriverHash(INDIANRIVER_YARD);
}

export function parseIndianriverPage(
  raw: string,
  index: number,
): IndianriverPage {
  indianriverPageUrl(index);
  const html = document(raw);
  const tables = prattElements(html, "table", (t) =>
    hasClass(t, "wpinventory_loop_all_table"),
  );
  if (tables.length !== 1 || !tables[0])
    throw new Error(
      "Indian River expected one complete native inventory table",
    );
  const sections = inventoryTableSections(tables[0].body);
  const headers = prattElements(sections.head, "th").map((v) =>
    prattText(v.body),
  );
  if (
    JSON.stringify(headers) !==
    JSON.stringify([
      "Year:",
      "Make:",
      "Model:",
      "Reference:",
      "Row:",
      "Arrival Date:",
      "Name:",
    ])
  )
    throw new Error("Indian River native table columns changed");
  const rows = prattElements(sections.body, "tr");
  if (
    [...sections.body.matchAll(/<tr\b/gi)].length !== rows.length ||
    [...html.matchAll(/<tr\b[^>]*class=["'][^"']*\bwpinventory_item\b/gi)]
      .length !== rows.length
  )
    throw new Error(
      "Indian River table contains unaccounted or incomplete donor rows",
    );
  const fields = [
    "year",
    "make",
    "model",
    "description",
    "number",
    "date_added",
    "name",
  ];
  const records = rows.map((row) => {
    const ids = attr(row.tag, "class")
      .split(/\s+/)
      .flatMap((c) => /^wpinventoryitem-(\d+)$/.exec(c)?.slice(1) ?? []);
    if (!hasClass(row.tag, "wpinventory_item") || ids.length !== 1)
      throw new Error(
        "Indian River donor lacks one native inventory traversal ID",
      );
    // The source omits intermediate </td> tags. HTML permits their omission.
    // Split the complete raw row on each opening cell, never repair missing rows.
    const cells = [
      ...row.body.matchAll(/(<td\b[^>]*>)([\s\S]*?)(?=<td\b|$)/gi),
    ];
    if (cells.length !== fields.length || /<t[hr]\b/i.test(row.body))
      throw new Error("Indian River donor cell structure changed");
    const values = cells.map((cell, i) => {
      if (attr(cell[1] ?? "", "class") !== "inventory_" + fields[i])
        throw new Error("Indian River donor cell order changed");
      return prattText(cell[2] ?? "");
    });
    return IndianriverRecordSchema.parse({
      id: ids[0],
      year: values[0],
      make: values[1],
      model: values[2],
      reference: values[3],
      vin: values[4],
      arrivalDate: values[5],
      paperwork: values[6],
    });
  });
  const paginations = prattElements(html, "div", (t) =>
    hasClass(t, "wpinventory_pagination"),
  );
  if (paginations.length !== 1 || !paginations[0])
    throw new Error("Indian River pagination is missing or ambiguous");
  const pagination = paginations[0].body;
  const start = html.indexOf(paginations[0].tag + pagination);
  const end = start + paginations[0].tag.length + pagination.length;
  const closingTag = /^<\/div\s*>/i.exec(html.slice(end))?.[0];
  if (
    start < 0 ||
    !closingTag ||
    prattContinuation(
      html.slice(0, start) + html.slice(end + closingTag.length),
    ).length
  )
    throw new Error(
      "Indian River has an unclassified continuation outside its complete page graph",
    );
  const showing = prattElements(pagination, "span", (t) =>
    hasClass(t, "wpinventory_showing"),
  );
  const match = /^Showing (\d+) - (\d+) of (\d+) items$/.exec(
    prattText(showing[0]?.body ?? ""),
  );
  if (showing.length !== 1 || !match)
    throw new Error("Indian River total/range evidence changed");
  const total = Number(match[3]),
    pages = Math.ceil(total / INDIANRIVER_PAGE_SIZE);
  const first = index * INDIANRIVER_PAGE_SIZE + 1,
    last = Math.min((index + 1) * INDIANRIVER_PAGE_SIZE, total);
  if (
    pages < 1 ||
    pages > INDIANRIVER_MAX_PAGES ||
    index >= pages ||
    Number(match[1]) !== first ||
    Number(match[2]) !== last ||
    records.length !== last - first + 1
  )
    throw new Error(
      "Indian River displayed range, row count and complete census total do not reconcile",
    );
  const numbered = new Set<number>();
  let current = 0;
  for (const link of prattElements(pagination, "a")) {
    const url = URL.parse(attr(link.tag, "href"), INDIANRIVER_ORIGIN);
    const number = url?.searchParams.get("inventory_page");
    const page =
      number !== null && number !== undefined && /^\d+$/.test(number)
        ? Number(number)
        : -1;
    // Literal links omit the slash and receive a documented canonical 301.
    const expected =
      page === 0
        ? indianriverPageUrl(1).replace("inventory_page=1", "inventory_page=0")
        : page >= 1 && page < pages
          ? indianriverPageUrl(page)
          : "";
    if (
      !url ||
      !expected ||
      url.href !== expected.replace("/inventory-3/?", "/inventory-3?") ||
      !hasClass(link.tag, "page")
    )
      throw new Error(
        "Indian River published continuation changed scope or destination",
      );
    const label = prattText(link.body);
    if (/^\d+$/.test(label)) {
      if (Number(label) !== page + 1 || numbered.has(page))
        throw new Error("Indian River numbered page controls conflict");
      numbered.add(page);
    } else if (
      (label === ">" && page !== index + 1) ||
      (label === ">>" && page !== pages - 1) ||
      (label === "<" && page !== index - 1) ||
      (label === "<<" && page !== 0) ||
      ![">", ">>", "<", "<<"].includes(label)
    )
      throw new Error("Indian River next/previous/last continuation conflicts");
    if (hasClass(link.tag, "page_current")) {
      current++;
      if (page !== index)
        throw new Error("Indian River requested and current page disagree");
    }
  }
  if (
    current !== 1 ||
    numbered.size !== pages ||
    [...Array(pages).keys()].some((i) => !numbered.has(i))
  )
    throw new Error("Indian River complete numbered page graph is missing");
  if (new Set(records.map((r) => r.id)).size !== records.length)
    throw new Error("Indian River page repeats a native traversal ID");
  return IndianriverPageSchema.parse({ index, total, records });
}
