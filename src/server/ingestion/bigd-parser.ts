import { z } from "zod";
import {
  inventoryHtmlAttribute,
  inventoryTableSections,
  stripInventoryRawText,
} from "./inventory-html";
import {
  BIGD_INVENTORY_URL,
  BIGD_YARD,
  type BigdYard,
} from "./bigd-yard-metadata";

export const BigdRecordSchema = z
  .object({
    year: z.string().max(500),
    make: z.string().max(500),
    model: z.string().max(500),
    vin: z.string().max(500),
    color: z.string().max(500),
    row: z.string().max(500),
    arrivalDate: z.string().max(500),
  })
  .strict();
export type BigdRecord = z.infer<typeof BigdRecordSchema>;
const columns = [
  ["Year", "Year"],
  ["Make", "Make"],
  ["Model", "Model"],
  ["VIN", "VIN"],
  ["Color", "Color"],
  ["Row", "Vehicle Row"],
  ["Arrived", "Arrival Date"],
] as const;
const text = (raw: string) =>
  raw
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();

function document(raw: string): string {
  if (Buffer.byteLength(raw) > 4_000_000 || !/<\/html\s*>\s*$/i.test(raw)) {
    throw new Error("Big D inventory HTML is oversized or truncated");
  }
  const html = stripInventoryRawText(raw);
  const plain = text(html);
  const links = [...html.matchAll(/<a\b[^>]*>/gi)].map(([tag]) =>
    inventoryHtmlAttribute(tag, "href"),
  );
  if (
    !links.includes("tel:2085221100") ||
    !plain.includes("1296 E. Iona Rd. Idaho Falls, ID 83401") ||
    !plain.includes("Big D Pick & Pull")
  ) {
    throw new Error(
      "Big D physical address, business name or phone changed; verify yard ownership before retrying",
    );
  }
  return html;
}

export function parseBigdYard(raw: string): BigdYard {
  const html = document(raw);
  const plain = text(html);
  if (
    !plain.includes(
      "Big D Pick & Pull is now proudly operating at the former location of D & C Salvage on the north side of Idaho Falls at 1296 E. Iona Rd.",
    ) ||
    ![...html.matchAll(/<a\b[^>]*>/gi)].some(
      ([tag]) => inventoryHtmlAttribute(tag, "href") === BIGD_INVENTORY_URL,
    )
  )
    throw new Error("Big D's linked physical salvage yard ownership changed");
  return BIGD_YARD;
}

/** This inspected initializer paginates the complete inline HTML locally. Any
 * change requires proving enumeration again before accepting reconciliation. */
function validatePagination(raw: string): void {
  const scripts = [
    ...raw
      .replace(/<!--[\s\S]*?-->/g, "")
      .matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi),
  ]
    .map((match) => match[1] ?? "")
    .filter((script) =>
      /#vehicles|\b(?:dataTable|DataTable|serverSide)\b/.test(script),
    );
  const expected =
    '$(document).ready(function(){$("#vehicles").dataTable({bLengthChange:true,"iDisplayLength":10,bInfo:false,responsive:true,"bAutoWidth":false,"pagingType":"full_numbers","order":[[6,"desc"]]});});';
  if (scripts.length !== 1 || scripts[0]?.replace(/\s+/g, "") !== expected) {
    throw new Error(
      "Big D inline pagination changed; re-establish complete unfiltered enumeration before retrying",
    );
  }
}

export function parseBigdInventory(raw: string): BigdRecord[] {
  const html = document(raw);
  validatePagination(raw);
  if (
    /<form\b|\bclass\s*=\s*["'][^"']*\b(?:pagination|page-numbers)\b/i.test(
      html,
    )
  ) {
    throw new Error(
      "Big D exposes an unprocessed inventory filter or pagination control",
    );
  }
  for (const [tag] of html.matchAll(/<a\b[^>]*>/gi)) {
    const href = inventoryHtmlAttribute(tag, "href");
    const rel = inventoryHtmlAttribute(tag, "rel") ?? "";
    const url =
      href === null ? null : URL.parse(text(href), BIGD_INVENTORY_URL);
    if (
      rel.split(/\s+/).includes("next") ||
      (url?.origin === "https://bigdsalvage.com" &&
        /^\/inventory(?:\/|$)/.test(url.pathname) &&
        (url.searchParams.size > 0 || /\/page\//.test(url.pathname)))
    ) {
      throw new Error(
        "Big D exposes an unprocessed inventory filter or pagination link",
      );
    }
  }
  const tables = [
    ...html.matchAll(/(<table\b[^>]*>)([\s\S]*?)<\/table\s*>/gi),
  ].filter(
    (match) => inventoryHtmlAttribute(match[1] ?? "", "id") === "vehicles",
  );
  const table = tables[0]?.[2];
  if (
    tables.length !== 1 ||
    table === undefined ||
    [...html.matchAll(/<table\b[^>]*>/gi)].filter(
      ([tag]) => inventoryHtmlAttribute(tag, "id") === "vehicles",
    ).length !== 1
  ) {
    throw new Error("Expected one complete Big D inventory table");
  }
  const { head, body } = inventoryTableSections(table);
  const heading = /^\s*<tr\b[^>]*>([\s\S]*?)<\/tr\s*>\s*$/i.exec(head)?.[1];
  const headings = [
    ...(heading ?? "").matchAll(/<th\b[^>]*>([\s\S]*?)<\/th\s*>/gi),
  ];
  if (
    headings.length !== columns.length ||
    headings.some(
      (cell, index) => text(cell[1] ?? "") !== columns[index]?.[1],
    ) ||
    heading?.replace(/<th\b[^>]*>[\s\S]*?<\/th\s*>/gi, "").trim()
  ) {
    throw new Error("Big D inventory columns changed");
  }
  const rows = [...body.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr\s*>/gi)];
  if (
    rows.length === 0 ||
    rows.length > 10_000 ||
    body.replace(/<tr\b[^>]*>[\s\S]*?<\/tr\s*>/gi, "").trim()
  ) {
    throw new Error("Big D inventory rows are empty, oversized or incomplete");
  }
  return rows.map((row) => {
    const content = row[1] ?? "";
    const cells = [...content.matchAll(/(<td\b[^>]*>)([\s\S]*?)<\/td\s*>/gi)];
    if (
      cells.length !== columns.length ||
      content.replace(/<td\b[^>]*>[\s\S]*?<\/td\s*>/gi, "").trim()
    ) {
      throw new Error("Big D donor cells are missing or nested");
    }
    const fields = cells.map((cell, index) => {
      const value = cell[2] ?? "";
      if (
        inventoryHtmlAttribute(cell[1] ?? "", "data-label") !==
          columns[index]?.[0] ||
        /<|>/.test(value) ||
        value.length > 500
      ) {
        throw new Error(
          "Big D donor fields changed labels, contain markup or exceed their bound",
        );
      }
      return text(value);
    });
    return {
      year: fields[0] ?? "",
      make: fields[1] ?? "",
      model: fields[2] ?? "",
      vin: fields[3] ?? "",
      color: fields[4] ?? "",
      row: fields[5] ?? "",
      arrivalDate: fields[6] ?? "",
    };
  });
}
