import { z } from "zod";
import {
  inventoryHtmlAttribute,
  inventoryTableSections,
  stripInventoryRawText,
} from "./inventory-html";
import { chasencarsElements, chasencarsText } from "./chasencars-html";
import {
  CHASENCARS_CATALOG,
  CHASENCARS_OWNER,
  CHASENCARS_YARD_URL,
} from "./chasencars-yard-metadata";

const text = z.string().max(500);
export const ChasencarsRecordSchema = z
  .object({
    year: text,
    make: text,
    model: text,
    engine: text,
    color: text,
    vin: text,
    stock: text,
    row: text,
    arrived: text,
  })
  .strict();
export type ChasencarsRecord = z.infer<typeof ChasencarsRecordSchema>;
export const ChasencarsCatalogSchema = z
  .object({
    updated: z.string().regex(/^\d{2}\/\d{2}\/\d{2}$/),
    records: z.array(ChasencarsRecordSchema).min(1).max(10_000),
  })
  .strict();
export type ChasencarsCatalog = z.infer<typeof ChasencarsCatalogSchema>;

function document(raw: string, url: string) {
  const html = stripInventoryRawText(raw);
  if (
    Buffer.byteLength(raw) > 2 * 1024 * 1024 ||
    !/<\/body\s*>\s*<\/html\s*>\s*$/i.test(html)
  )
    throw new Error("Chase N Cars document is oversized or incomplete");
  const canonicals = [...html.matchAll(/<link\b[^>]*>/gi)].filter(
    ([tag]) => inventoryHtmlAttribute(tag, "rel") === "canonical",
  );
  if (
    canonicals.length !== 1 ||
    inventoryHtmlAttribute(canonicals[0]?.[0] ?? "", "href") !== url
  )
    throw new Error("Chase N Cars canonical destination changed");
  const visible = chasencarsText(html).toLowerCase();
  const links = [...html.matchAll(/<a\b[^>]*>/gi)].map(([tag]) =>
    inventoryHtmlAttribute(tag, "href"),
  );
  if (
    !["chase n cars", "6471 state highway 66", "tulsa, ok 74131"].every(
      (value) => visible.includes(value),
    ) ||
    !links.includes("tel:9185848483") ||
    !links.includes(CHASENCARS_CATALOG) ||
    /(?:inventory|vehicle search)\s+(?:is\s+)?(?:disabled|archived|unavailable)/i.test(
      visible,
    )
  )
    throw new Error(
      "Chase N Cars operator, physical address, phone or active inventory scope changed",
    );
  return html;
}
export function parseChasencarsOwner(raw: string): void {
  const visible = chasencarsText(document(raw, CHASENCARS_OWNER));
  if (
    !visible.includes("Simply bring your tools, remove the part yourself") ||
    !visible.includes("Search our yard inventory online!")
  )
    throw new Error("Chase N Cars own-yard donor assertion changed");
}
export function parseChasencarsYard(raw: string): void {
  const visible = chasencarsText(document(raw, CHASENCARS_YARD_URL));
  if (
    !visible.includes(
      "We are a U-pull It Salvage Yard located Tulsa, Oklahoma",
    ) ||
    !visible.includes("Bring your tools, pull the part yourself")
  )
    throw new Error("Chase N Cars physical yard ownership changed");
}
export function parseChasencarsCatalog(raw: string): ChasencarsCatalog {
  const html = document(raw, CHASENCARS_CATALOG);
  if (/<iframe\b/i.test(html))
    throw new Error(
      "Chase N Cars inventory gained an unclassified external surface",
    );
  const initializers = [
    ...raw
      .replace(/<!--[\s\S]*?-->/g, "")
      .matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi),
  ]
    .map((match) => match[1] ?? "")
    .filter((script) => script.includes("#vehicles"));
  if (
    initializers.length !== 1 ||
    initializers[0]?.replace(/\s+/g, "") !==
      '$(document).ready(function(){$("#vehicles").dataTable({bLengthChange:true,"iDisplayLength":10,bInfo:false,responsive:true,"bAutoWidth":false,"pagingType":"full_numbers","order":[[6,"desc"]]});});'
  )
    throw new Error(
      "Chase N Cars local DOM pagination changed; re-establish complete enumeration",
    );
  const tables = chasencarsElements(html, "table");
  if (
    tables.length !== 1 ||
    inventoryHtmlAttribute(tables[0]?.tag ?? "", "id") !== "vehicles"
  )
    throw new Error("Chase N Cars requires one complete native vehicles table");
  const { head, body } = inventoryTableSections(tables[0]?.body ?? "");
  if (
    chasencarsElements(head, "tr").length !== 1 ||
    head.replace(/<tr\b[^>]*>[\s\S]*?<\/tr\s*>/gi, "").trim()
  )
    throw new Error("Chase N Cars inventory header row is incomplete");
  const headings = chasencarsElements(head, "th").map(({ body }) =>
    chasencarsText(body),
  );
  if (
    JSON.stringify(headings) !==
    JSON.stringify([
      "Year",
      "Make",
      "Model",
      "Engine",
      "Color",
      "VIN",
      "Stock#",
      "Row#",
      "Arrival Date",
    ])
  )
    throw new Error("Chase N Cars inventory headings changed");
  const rows = chasencarsElements(body, "tr");
  if (body.replace(/<tr\b[^>]*>[\s\S]*?<\/tr\s*>/gi, "").trim())
    throw new Error("Chase N Cars inventory has unclassified rows");
  const labels = [
    "Year",
    "Make",
    "Model",
    "Engine",
    "Color",
    "VIN",
    "StockNumber",
    "Row",
    "Arrived",
  ];
  const records = rows.map(({ body }) => {
    const cells = chasencarsElements(body, "td");
    if (
      cells.length !== labels.length ||
      body.replace(/<td\b[^>]*>[\s\S]*?<\/td\s*>/gi, "").trim()
    )
      throw new Error("Chase N Cars donor cells are incomplete");
    const values = cells.map(({ tag, body }, index) => {
      if (
        inventoryHtmlAttribute(tag, "data-label") !== labels[index] ||
        /<[^>]*>/.test(body)
      )
        throw new Error(
          "Chase N Cars donor field changed its native label or gained an unowned destination",
        );
      return chasencarsText(body);
    });
    return ChasencarsRecordSchema.parse({
      year: values[0],
      make: values[1],
      model: values[2],
      engine: values[3],
      color: values[4],
      vin: values[5],
      stock: values[6],
      row: values[7],
      arrived: values[8],
    });
  });
  const updates = [
    ...chasencarsText(html).matchAll(
      /Inventory Updated: (\d{2}\/\d{2}\/\d{2})/g,
    ),
  ];
  if (updates.length !== 1)
    throw new Error("Chase N Cars native update label changed");
  return ChasencarsCatalogSchema.parse({ updated: updates[0]?.[1], records });
}
