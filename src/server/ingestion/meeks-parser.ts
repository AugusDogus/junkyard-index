import { createHash } from "node:crypto";
import { z } from "zod";
import {
  inventoryHtmlAttribute,
  inventoryTableSections,
} from "./inventory-html";
import { meeksDocument, meeksImageUrl, meeksText } from "./meeks-html";
import {
  MEEKS_FULL_INVENTORY_URL,
  MEEKS_INVENTORY_URL,
  MEEKS_ORIGIN,
} from "./meeks-yard-metadata";

export const MeeksRecordSchema = z
  .object({
    year: z.string().max(300),
    make: z.string().max(300),
    model: z.string().max(300),
    color: z.string().max(300),
    stock: z.string().max(300),
    vin: z.string().max(300),
    row: z.string().max(300),
    arrival: z.string().max(300),
    imageUrl: z.string().max(1500).nullable(),
    location: z.string().max(300).nullable(),
  })
  .strict();
export type MeeksRecord = z.infer<typeof MeeksRecordSchema>;
export const meeksHash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
export interface MeeksPage {
  view: "yard" | "full";
  sourceUrl: string;
  records: MeeksRecord[];
  hash: string;
}

export function parseMeeksOwner(raw: string): void {
  const html = meeksDocument(raw, MEEKS_ORIGIN + "/");
  const body = html
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");
  const urls = [...html.matchAll(/<a\b[^>]*>/gi)].map(([tag]) =>
    inventoryHtmlAttribute(tag, "href"),
  );
  if (
    !/Meeks Pic-N-Pull\s+1205 Virginia Ave Martinsville, VA/.test(body) ||
    !body.includes("(276) 638-0710") ||
    !body.includes("Use your own tools") ||
    !body.includes(
      "Independent, Locally-owned, And Operated PIC and PULL Parts yard and SALVAGE YARD",
    ) ||
    !body.includes("Meeks Recycling and Salvage LLC") ||
    !urls.includes(MEEKS_INVENTORY_URL) ||
    !urls.includes(MEEKS_FULL_INVENTORY_URL)
  )
    throw new Error(
      "Meeks donor-yard identity, self-service scope or source-owned inventory link changed; previous inventory must be preserved",
    );
}

function localTable(raw: string, html: string): void {
  const scripts = [
    ...raw
      .replace(/<!--[\s\S]*?-->/g, "")
      .matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi),
  ]
    .map((match) => match[1] ?? "")
    .filter((body) => /["']#vehicles["']/.test(body));
  const initialization = scripts[0]?.replace(/\s+/g, "");
  // This is client pagination of the inline table. No script is executed and
  // display length is never used as a source count or completeness assertion.
  if (
    scripts.length !== 1 ||
    !/^\$\(document\)\.ready\(function\(\)\{\$\("#vehicles"\)\.dataTable\(\{"LengthChange":true,"iDisplayLength":(?:-1|[1-9]\d{0,3}),"Info":true,responsive:true,"AutoWidth":true,"pagingType":"full_numbers","order":\[\[(?:[0-9]|10),"(?:asc|desc)"\]\]\}\);\}\);$/.test(
      initialization ?? "",
    )
  )
    throw new Error(
      "Meeks inline table initialization changed; remote or partial inventory cannot establish complete coverage",
    );
  for (const match of html.matchAll(
    /(<(?:a|button)\b[^>]*>)([\s\S]*?)<\/(?:a|button)>/gi,
  )) {
    const tag = match[1] ?? "";
    const url = URL.parse(
      meeksText(inventoryHtmlAttribute(tag, "href") ?? ""),
      MEEKS_INVENTORY_URL,
    );
    if (
      /\b(?:next|prev)\b/i.test(inventoryHtmlAttribute(tag, "rel") ?? "") ||
      /^(?:next(?: page)?|previous(?: page)?|load more|show more)$/i.test(
        meeksText(match[2] ?? ""),
      ) ||
      (url?.origin === MEEKS_ORIGIN &&
        (/\/page\//i.test(url.pathname) ||
          /(?:page|paged|offset|cursor)=/i.test(url.search)))
    )
      throw new Error(
        "Meeks publishes an unread inventory continuation; preserve prior inventory and inspect the control",
      );
  }
}

function rows(section: string, kind: "td" | "th", columns: number): string[][] {
  const matches = [...section.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr\s*>/gi)];
  if (
    matches.length !== [...section.matchAll(/<\/?tr\b/gi)].length / 2 ||
    section.replace(/<tr\b[^>]*>[\s\S]*?<\/tr\s*>/gi, "").trim()
  )
    throw new Error(
      "Meeks table has incomplete or out-of-row cells; inspect the saved document",
    );
  return matches.map((match) => {
    const row = match[1] ?? "";
    const pattern = new RegExp(
      `<${kind}\\b[^>]*>([\\s\\S]*?)<\\/${kind}\\s*>`,
      "gi",
    );
    const cells = [...row.matchAll(pattern)];
    if (
      cells.length !== columns ||
      [...row.matchAll(/<\/?(?:td|th)\b/gi)].length !== columns * 2 ||
      row.replace(pattern, "").trim()
    )
      throw new Error(
        `Meeks table row lacks ${columns} complete cells; no donor row was omitted`,
      );
    return cells.map((cell) => cell[1] ?? "");
  });
}

export function parseMeeksInventory(
  raw: string,
  view: "yard" | "full" = "yard",
): MeeksPage {
  const sourceUrl =
    view === "yard" ? MEEKS_INVENTORY_URL : MEEKS_FULL_INVENTORY_URL;
  const html = meeksDocument(raw, sourceUrl);
  const plain = html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");
  if (
    !plain.includes(
      view === "yard"
        ? "PIC and PULL Inventory"
        : "PIC and PULL Full Inventory",
    ) ||
    !plain.includes("Meeks Recycling and Salvage LLC") ||
    !plain.includes("Martinsville, VA") ||
    !plain.includes("276-656-1018")
  )
    throw new Error(
      "Meeks inventory owner or donor scope changed; preserve the previous snapshot",
    );
  localTable(raw, html);
  const tables = [...html.matchAll(/(<table\b[^>]*>)([\s\S]*?)<\/table\s*>/gi)];
  const table = tables[0];
  if (
    tables.length !== 1 ||
    [...html.matchAll(/<\/?table\b/gi)].length !== 2 ||
    inventoryHtmlAttribute(table?.[1] ?? "", "id") !== "vehicles" ||
    /\bdata-(?:url|ajax|server|source)/i.test(table?.[1] ?? "")
  )
    throw new Error(
      "Meeks expected one complete local vehicles table; inspect its boundary before continuing",
    );
  const sections = inventoryTableSections(table?.[2] ?? "");
  const columns = view === "yard" ? 11 : 12;
  const headers = rows(sections.head, "th", columns).map((cells) =>
    cells.map((cell) => meeksText(cell)),
  );
  const expected = [
    "Year",
    "Make",
    "Model",
    "Color",
    "Stock #",
    "VIN #",
    ...(view === "full" ? ["Location", "Yard Row"] : ["Vehicle Row"]),
    "Arrival Date",
    "Front",
    "Rear",
    "Inside",
  ];
  if (JSON.stringify(headers) !== JSON.stringify([expected]))
    throw new Error(
      "Meeks inventory headers changed; VIN must remain bound to the explicit VIN # column",
    );
  const native = rows(sections.body, "td", columns);
  if (!native.length || native.length > 10_000)
    throw new Error(
      "Meeks inventory is empty or exceeds the supported row limit; previous inventory is preserved",
    );
  const records = native.map((cells) => {
    const offset = view === "full" ? 1 : 0;
    const front = cells[8 + offset] ?? "";
    let imageUrl: string | null = null;
    try {
      const links = [...front.matchAll(/<a\b[^>]*>/gi)];
      imageUrl =
        links.length === 1
          ? meeksImageUrl(inventoryHtmlAttribute(links[0]?.[0] ?? "", "href"))
          : null;
    } catch {
      /* Malformed optional photo metadata does not reject a donor. */
    }
    // Native VIN td repeats StockNumber. The verified headers establish the
    // positional boundary independently of this misleading optional label.
    return MeeksRecordSchema.parse({
      year: meeksText(cells[0] ?? ""),
      make: meeksText(cells[1] ?? ""),
      model: meeksText(cells[2] ?? ""),
      color: meeksText(cells[3] ?? "", true),
      stock: meeksText(cells[4] ?? "", true),
      vin: meeksText(cells[5] ?? ""),
      row: meeksText(cells[6 + offset] ?? "", true),
      arrival: meeksText(cells[7 + offset] ?? "", true),
      imageUrl,
      location: view === "full" ? meeksText(cells[6] ?? "", true) : null,
    });
  });
  return { view, sourceUrl, records, hash: meeksHash([view, records]) };
}
