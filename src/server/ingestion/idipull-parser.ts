import {
  inventoryHtmlAttribute,
  inventoryTableSections,
  stripInventoryRawText,
} from "./inventory-html";
import {
  IDIPULL_INVENTORY_URL,
  IDIPULL_MAP_URL,
  IDIPULL_YARD,
  type IdipullYard,
} from "./idipull-yard-metadata";

export interface IdipullRecord {
  year: string;
  make: string;
  model: string;
  reference: string;
  vin: string;
  color: string;
  stockNumber: string;
  row: string;
  arrivalDate: string;
}
const columns = [
  ["Year", "Year"],
  ["Make", "Make"],
  ["Model", "Model"],
  ["Reference", "Reference"],
  ["VIN", "VIN"],
  ["Color", "Color"],
  ["StockNumber", "Stock #"],
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
    throw new Error("Idaho Falls inventory HTML is oversized or truncated");
  }
  const html = stripInventoryRawText(raw);
  const plain = text(html);
  const links = [...html.matchAll(/<a\b[^>]*>/gi)].map(([tag]) =>
    inventoryHtmlAttribute(tag, "href"),
  );
  if (
    !links.includes(IDIPULL_MAP_URL) ||
    !links.includes("tel:2085244461") ||
    !plain.includes("3015 N 15th E Idaho Falls, ID 83401")
  ) {
    throw new Error(
      "Idaho Falls physical address, native business pin or phone changed; verify yard ownership before retrying",
    );
  }
  return html;
}

export function parseIdipullYard(raw: string): IdipullYard {
  const html = document(raw);
  const plain = text(html);
  if (
    !plain.includes(
      "Search our in-stock vehicles to ensure you find the part you need. Updated daily.",
    ) ||
    !plain.includes("Bring your own tools and pull your own parts.") ||
    ![...html.matchAll(/<a\b[^>]*>/gi)].some(
      ([tag]) => inventoryHtmlAttribute(tag, "href") === IDIPULL_INVENTORY_URL,
    )
  ) {
    throw new Error(
      "Idaho Falls no longer confirms the linked in-stock self-service inventory",
    );
  }
  return IDIPULL_YARD;
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
      "Idaho Falls inline pagination changed; re-establish complete unfiltered enumeration before retrying",
    );
  }
}

export function parseIdipullInventory(raw: string): IdipullRecord[] {
  const html = document(raw);
  validatePagination(raw);
  if (
    /<form\b|\bclass\s*=\s*["'][^"']*\b(?:pagination|page-numbers)\b/i.test(
      html,
    )
  ) {
    throw new Error(
      "Idaho Falls exposes an unprocessed inventory filter or pagination control",
    );
  }
  for (const [tag] of html.matchAll(/<a\b[^>]*>/gi)) {
    const href = inventoryHtmlAttribute(tag, "href");
    const rel = inventoryHtmlAttribute(tag, "rel") ?? "";
    const url =
      href === null ? null : URL.parse(text(href), IDIPULL_INVENTORY_URL);
    if (
      rel.split(/\s+/).includes("next") ||
      (url?.origin === "https://ifipull.com" &&
        /^\/inventory(?:\/|$)/.test(url.pathname) &&
        (url.searchParams.size > 0 || /\/page\//.test(url.pathname)))
    ) {
      throw new Error(
        "Idaho Falls exposes an unprocessed inventory filter or pagination link",
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
    throw new Error("Expected one complete Idaho Falls inventory table");
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
    throw new Error("Idaho Falls inventory columns changed");
  }
  const rows = [...body.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr\s*>/gi)];
  if (
    rows.length === 0 ||
    rows.length > 10_000 ||
    body.replace(/<tr\b[^>]*>[\s\S]*?<\/tr\s*>/gi, "").trim()
  ) {
    throw new Error(
      "Idaho Falls inventory rows are empty, oversized or incomplete",
    );
  }
  return rows.map((row) => {
    const content = row[1] ?? "";
    const cells = [...content.matchAll(/(<td\b[^>]*>)([\s\S]*?)<\/td\s*>/gi)];
    if (
      cells.length !== columns.length ||
      content.replace(/<td\b[^>]*>[\s\S]*?<\/td\s*>/gi, "").trim()
    ) {
      throw new Error("Idaho Falls donor cells are missing or nested");
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
          "Idaho Falls donor fields changed labels, contain markup or exceed their bound",
        );
      }
      return text(value);
    });
    return {
      year: fields[0] ?? "",
      make: fields[1] ?? "",
      model: fields[2] ?? "",
      reference: fields[3] ?? "",
      vin: fields[4] ?? "",
      color: fields[5] ?? "",
      stockNumber: fields[6] ?? "",
      row: fields[7] ?? "",
      arrivalDate: fields[8] ?? "",
    };
  });
}
