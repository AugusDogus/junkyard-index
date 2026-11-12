import {
  inventoryHtmlAttribute,
  inventoryTableSections,
  stripInventoryRawText,
} from "./inventory-html";

export interface AeroRecent {
  year: string;
  make: string;
  model: string;
  engine: string;
  color: string;
  stock: string;
  row: string;
}
export interface AeroRecord extends AeroRecent {
  vin: string;
  arrived: string;
  images: readonly string[];
}

function text(raw: string): string {
  const named = new Map([
    ["amp", "&"],
    ["lt", "<"],
    ["gt", ">"],
    ["quot", '"'],
    ["apos", "'"],
    ["nbsp", " "],
  ]);
  return raw
    .replace(/<[^>]*>/g, " ")
    .replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (entity: string, key: string) => {
      if (!key.startsWith("#")) {
        const value = named.get(key.toLowerCase());
        if (value === undefined)
          throw new Error("Unsupported Aero entity " + entity);
        return value;
      }
      const hex = key.slice(0, 2).toLowerCase() === "#x";
      const point = Number.parseInt(key.slice(hex ? 2 : 1), hex ? 16 : 10);
      if (
        point <= 0 ||
        point > 0x10ffff ||
        (point >= 0xd800 && point <= 0xdfff)
      )
        throw new Error("Invalid Aero character reference");
      return String.fromCodePoint(point);
    })
    .replace(/\s+/g, " ")
    .trim();
}

function table(html: string, headers: readonly string[]): string[] {
  if (html.length > 2_000_000 || !/<\/html>\s*$/i.test(html))
    throw new Error("Aero page is oversized or truncated");
  const clean = stripInventoryRawText(html);
  const openings = [...clean.matchAll(/<table\b[^>]*>/gi)].filter(
    ([tag]) => inventoryHtmlAttribute(tag, "id") === "vehicles",
  );
  const tables = [
    ...clean.matchAll(/<table\b([^>]*)>([\s\S]*?)<\/table\s*>/gi),
  ].filter(
    (match) =>
      inventoryHtmlAttribute(
        match[0].slice(0, match[0].indexOf(">") + 1),
        "id",
      ) === "vehicles",
  );
  const content = tables[0]?.[2];
  if (openings.length !== 1 || tables.length !== 1 || content === undefined)
    throw new Error("Expected one complete Aero inventory table");
  const { head, body } = inventoryTableSections(content);
  const headingRow = /^\s*<tr\b[^>]*>([\s\S]*?)<\/tr>\s*$/i.exec(head)?.[1];
  const headings =
    headingRow === undefined
      ? []
      : [...headingRow.matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/gi)];
  if (
    headings.length !== headers.length ||
    headings.some((m, i) => text(m[1] ?? "") !== headers[i]) ||
    headingRow?.replace(/<th\b[^>]*>[\s\S]*?<\/th>/gi, "").trim()
  )
    throw new Error("Aero inventory headings changed");
  const rows = [...body.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)];
  if (
    rows.length === 0 ||
    rows.length > 10_000 ||
    body.replace(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi, "").trim() ||
    rows.some((m) => /<\/?tr\b/i.test(m[1] ?? ""))
  )
    throw new Error("Aero inventory rows are empty, incomplete or oversized");
  return rows.map((m) => m[1] ?? "");
}

function cells(row: string, labels: readonly string[]): string[] {
  const parts = row.trim().split(/(?=<td\b)/i);
  if (parts.length !== labels.length)
    throw new Error("Aero inventory cell count changed");
  return parts.map((part, index) => {
    const match = /^(<td\b[^>]*>)([\s\S]*)$/i.exec(part);
    const tag = match?.[1];
    const label = labels[index];
    const raw = match?.[2];
    if (
      !tag ||
      raw === undefined ||
      inventoryHtmlAttribute(tag, "data-label") !== label
    )
      throw new Error("Missing or reordered Aero inventory cell " + label);
    // Only native photo cells have HTML's optional td end tag. Descriptive
    // cells must close explicitly; a partial field must never consume another.
    if (label !== "Img" && !/<\/td>\s*$/i.test(raw))
      throw new Error("Unclosed Aero descriptive cell " + label);
    const value = raw.replace(/<\/td>\s*$/i, "");
    if (/<\/?(?:td|th|tr)\b/i.test(value))
      throw new Error("Unexpected nested Aero inventory cell");
    return value;
  });
}

function recent(fields: readonly string[]): AeroRecent {
  return {
    year: text(fields[0] ?? ""),
    make: text(fields[1] ?? ""),
    model: text(fields[2] ?? ""),
    engine: text(fields[3] ?? ""),
    color: text(fields[4] ?? ""),
    stock: text(fields[5] ?? ""),
    row: text(fields[6] ?? ""),
  };
}

export function parseAeroRecent(html: string): AeroRecent[] {
  return table(html, [
    "Year",
    "Make",
    "Model",
    "Engine",
    "Color",
    "Stock #",
    "Row",
  ]).map((row) =>
    recent(
      cells(row, [
        "Year",
        "Make",
        "Model",
        "Engine",
        "Color",
        "StockNumber",
        "Row",
      ]),
    ),
  );
}

export function parseAeroCatalog(html: string): AeroRecord[] {
  // This inspected native initializer enumerates an inline table. Any option
  // change requires rechecking pagination, especially Ajax/server-side modes.
  const scripts = [
    ...html
      .replace(/<!--[\s\S]*?-->/g, "")
      .matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi),
  ]
    .map((m) => m[1] ?? "")
    .filter((script) => script.includes("#vehicles"));
  const config = scripts[0]?.replace(/\s+/g, "");
  if (
    scripts.length !== 1 ||
    config !==
      '$(document).ready(function(){$("#vehicles").dataTable({bLengthChange:true,"iDisplayLength":10,bInfo:false,responsive:true,"bAutoWidth":false,"pagingType":"full_numbers","order":[[6,"desc"]]});});'
  )
    throw new Error(
      "Aero inline pagination contract changed; inspect complete traversal before retrying",
    );
  return table(html, [
    "Year",
    "Make",
    "Model",
    "Engine",
    "Color",
    "VIN",
    "Stock#",
    "Row#",
    "Arrival Date",
    ...Array.from({ length: 5 }, () => "Img"),
  ]).map((row) => {
    const fields = cells(row, [
      "Year",
      "Make",
      "Model",
      "Engine",
      "Color",
      "VIN",
      "StockNumber",
      "Row",
      "Arrived",
      ...Array.from({ length: 5 }, () => "Img"),
    ]);
    return {
      ...recent([...fields.slice(0, 5), ...fields.slice(6, 8)]),
      vin: text(fields[5] ?? ""),
      arrived: text(fields[8] ?? ""),
      images: fields.slice(9).flatMap((cell) =>
        [...cell.matchAll(/<a\b[^>]*>/gi)].flatMap(([tag]) => {
          const href = inventoryHtmlAttribute(tag, "href");
          return href === null ? [] : [text(href)];
        }),
      ),
    };
  });
}
