import { createHash } from "node:crypto";
import { z } from "zod";
import { fenixPhotoUrl } from "./fenix-photo";
import {
  inventoryHtmlAttribute,
  inventoryTableSections,
  stripInventoryRawText,
} from "./inventory-html";
import {
  FENIX_INVENTORY_URL,
  FENIX_ORIGIN,
  FENIX_YARDS,
  type FenixYardCode,
  validateFenixYards,
} from "./fenix-yard-metadata";

const field = z.string().max(300);
export const FenixDetailIdSchema = z.string().regex(/^(?:\d{1,20}|STK\d{6})$/);
export const FenixRecordSchema = z
  .object({
    id: FenixDetailIdSchema,
    datePlacedInYard: field,
    make: field,
    model: field,
    year: field,
    row: field,
    vin: field,
    stock: field,
    location: field,
    photoUrl: z.string().url().max(4096).nullable(),
  })
  .strict();
export type FenixRecord = z.infer<typeof FenixRecordSchema>;
export type FenixOrder = "ASC" | "DESC";
export const fenixHash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

function decode(raw: string): string {
  const named: Readonly<Record<string, string>> = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    nbsp: " ",
  };
  return raw.replace(
    /&(#x[\da-f]+|#\d+|[a-z]+);/gi,
    (entity: string, key: string) => {
      if (!key.startsWith("#")) {
        const value = named[key.toLowerCase()];
        if (value === undefined)
          throw new Error("Unsupported Fenix entity " + entity);
        return value;
      }
      const hex = /^#x/i.test(key);
      const point = Number.parseInt(key.slice(hex ? 2 : 1), hex ? 16 : 10);
      if (
        point <= 0 ||
        point > 0x10ffff ||
        (point >= 0xd800 && point <= 0xdfff)
      )
        throw new Error("Invalid Fenix character reference");
      return String.fromCodePoint(point);
    },
  );
}
const text = (raw: string) =>
  decode(raw.replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
const attr = (tag: string, name: string) => {
  const value = inventoryHtmlAttribute(tag, name);
  return value === null ? null : decode(value);
};

export function fenixPageUrl(order: FenixOrder, page: number): string {
  return `${FENIX_INVENTORY_URL}?sort_column=date_placed&sort_direction=${order}&pg=${page}`;
}

function publishedPage(raw: string, order: FenixOrder): number {
  const url = URL.parse(raw, FENIX_ORIGIN);
  const page = url?.searchParams.get("pg") ?? "";
  if (
    !url ||
    url.origin !== FENIX_ORIGIN ||
    url.username ||
    url.password ||
    url.pathname !== "/recent-inventory/" ||
    url.hash ||
    url.searchParams.size !== 3 ||
    url.searchParams.get("sort_column") !== "date_placed" ||
    url.searchParams.get("sort_direction") !== order ||
    !/^[1-9]\d{0,2}$/.test(page)
  )
    throw new Error("Fenix published pagination or date sort changed");
  return Number(page);
}

export function parseFenixInventory(
  raw: string,
  yard: FenixYardCode,
  order: FenixOrder,
  page: number,
) {
  if (Buffer.byteLength(raw) > 4 * 1024 * 1024 || !/<\/html\s*>\s*$/i.test(raw))
    throw new Error("Fenix document is oversized or truncated");
  const html = stripInventoryRawText(raw);
  validateFenixYards(html);
  const body = /<body\b([^>]*)>/i.exec(html)?.[1] ?? "";
  const scopeText = html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");
  if (
    !attr(body, "class")
      ?.split(/\s+/)
      .includes(yard + "-" + FENIX_YARDS[yard].state.toLowerCase()) ||
    !scopeText.includes(
      "View the full inventory of cars placed in our yard.",
    ) ||
    !scopeText.includes("Our inventory is always being updated")
  )
    throw new Error("Fenix active inventory ownership or public scope changed");
  const tables = [
    ...html.matchAll(/<table\b([^>]*)>([\s\S]*?)<\/table\s*>/gi),
  ].filter((match) => attr(match[1] ?? "", "id") === "inv-table");
  const table = tables[0]?.[2];
  if (tables.length !== 1 || !table)
    throw new Error("Fenix inventory table is missing or ambiguous");
  const { head, body: rows } = inventoryTableSections(table);
  const headers = [...head.matchAll(/<th\b([^>]*)>([\s\S]*?)<\/th\s*>/gi)];
  const expected = [
    "Date Placed In Yard",
    "Make",
    "Model",
    "Year",
    "Row",
    "VIN",
    "Stock Number",
    "Location",
    "Image",
    "",
  ];
  if (
    JSON.stringify(headers.map((h) => text(h[2] ?? ""))) !==
    JSON.stringify(expected)
  )
    throw new Error("Fenix inventory columns changed");
  const opposite: FenixOrder = order === "DESC" ? "ASC" : "DESC";
  const onclick = attr(headers[0]?.[1] ?? "", "onclick");
  const oppositePath = /^window\.location\.href='([^']+)'$/.exec(
    onclick ?? "",
  )?.[1];
  if (!oppositePath || publishedPage(oppositePath, opposite) !== page)
    throw new Error("Fenix opposite date sort is not source-published");
  const matches = [...rows.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr\s*>/gi)];
  if (
    /<\/?(?:tr|td|th)\b/i.test(
      rows.replace(/<tr\b[^>]*>[\s\S]*?<\/tr\s*>/gi, ""),
    )
  )
    throw new Error("Fenix inventory rows are malformed");
  const records = matches.map((match) => {
    const row = match[1] ?? "";
    const cells = [...row.matchAll(/<td\b([^>]*)>([\s\S]*?)<\/td\s*>/gi)];
    if (
      cells.length !== 10 ||
      /<\/?(?:tr|th)\b|\b(?:rowspan|colspan)\s*=/i.test(row) ||
      /<\/?td\b/i.test(row.replace(/<td\b[^>]*>[\s\S]*?<\/td\s*>/gi, ""))
    )
      throw new Error("Fenix inventory row columns changed");
    const values = cells.map((cell) => text(cell[2] ?? ""));
    const links = [...row.matchAll(/<a\b([^>]*)>/gi)].map((link) => {
      const href = attr(link[1] ?? "", "href");
      const url = href ? URL.parse(href, FENIX_ORIGIN) : null;
      if (
        !url ||
        url.origin !== FENIX_ORIGIN ||
        url.username ||
        url.password ||
        url.search ||
        url.hash ||
        !/^\/inventory\/(?:\d{1,20}|STK\d{6})\/?$/.test(url.pathname)
      )
        throw new Error("Fenix donor detail destination is invalid");
      return url.pathname.split("/")[2];
    });
    const id = links[0];
    if (!id || new Set(links).size !== 1)
      throw new Error("Fenix donor detail identity is missing or ambiguous");
    const images = [...(cells[8]?.[2] ?? "").matchAll(/<img\b([^>]*)>/gi)];
    const photoUrl =
      images.length === 1
        ? fenixPhotoUrl(attr(images[0]?.[1] ?? "", "src"), id)
        : null;
    const record = FenixRecordSchema.parse({
      id,
      datePlacedInYard: values[0],
      make: values[1],
      model: values[2],
      year: values[3],
      row: values[4],
      vin: values[5],
      stock: values[6],
      location: values[7],
      photoUrl,
    });
    if (
      record.location !==
        `${FENIX_YARDS[yard].city}, ${FENIX_YARDS[yard].state}` ||
      ((/^[1-9]\d{8}$/.test(record.stock) || id.startsWith("STK")) &&
        record.stock !== id)
    )
      throw new Error(
        "Fenix donor yard or stock ownership disagrees with its native detail",
      );
    return record;
  });
  const pagers = [
    ...html.matchAll(/<div\b([^>]*)>([\s\S]*?)<\/div\s*>/gi),
  ].filter((m) =>
    attr(m[1] ?? "", "class")
      ?.split(/\s+/)
      .includes("fnx-pagination"),
  );
  const pager = pagers[0]?.[2];
  if (pagers.length !== 1 || !pager)
    throw new Error("Fenix published page boundary is missing");
  const links = [...pager.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi)];
  const linkPage = (label: string) => {
    const matches = links.filter((m) => text(m[2] ?? "") === label);
    const href = attr(matches[0]?.[1] ?? "", "href");
    if (matches.length !== 1 || !href)
      throw new Error("Fenix published pagination is ambiguous");
    return publishedPage(href, order);
  };
  const lastPage = linkPage(">>");
  const position = /(?:^|\s)(\d+) of (\d+)(?:\s|$)/.exec(text(pager));
  if (
    Number(position?.[1]) !== page ||
    Number(position?.[2]) !== lastPage ||
    page > lastPage ||
    linkPage(">") !== page + 1 ||
    records.length < 1 ||
    records.length > 50 ||
    (page < lastPage && records.length !== 50)
  )
    throw new Error("Fenix page capacity or terminal boundary changed");
  return {
    records,
    page,
    lastPage,
    oppositeUrl: new URL(oppositePath, FENIX_ORIGIN).href,
    nextUrl: fenixPageUrl(order, page + 1),
    hash: fenixHash(records),
  };
}
