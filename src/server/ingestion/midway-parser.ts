import { midwayVehiclePhoto } from "./vehicle-photo";
import {
  inventoryHtmlAttribute,
  inventoryTableSections,
  stripInventoryRawText,
} from "./inventory-html";
import {
  MIDWAY_ORIGIN,
  midwayMakeInventoryUrl,
  type MidwayInventoryCode,
} from "./midway-yard-metadata";

export interface MidwayRecord {
  year: string;
  make: string;
  model: string;
  row: string;
  arrived: string;
  vin: string;
  stock: string;
  imageUrl?: string | null;
}

function text(raw: string): string {
  const named = new Map([
    ["amp", "&"],
    ["nbsp", " "],
    ["quot", '"'],
    ["apos", "'"],
    ["lt", "<"],
    ["gt", ">"],
    ["mdash", "\u2014"],
    ["ndash", "\u2013"],
  ]);
  return raw
    .replace(/<[^>]*>/g, " ")
    .replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (entity: string, key: string) => {
      if (!key.startsWith("#")) {
        const value = named.get(key.toLowerCase());
        if (value === undefined)
          throw new Error("Unsupported Midway entity " + entity);
        return value;
      }
      const hex = key.slice(0, 2).toLowerCase() === "#x";
      const point = Number.parseInt(key.slice(hex ? 2 : 1), hex ? 16 : 10);
      if (
        point <= 0 ||
        point > 0x10ffff ||
        (point >= 0xd800 && point <= 0xdfff)
      )
        throw new Error("Invalid Midway character reference");
      return String.fromCodePoint(point);
    })
    .replace(/\s+/g, " ")
    .trim();
}

function classContains(tag: string, name: string) {
  return (
    inventoryHtmlAttribute(tag, "class")?.split(/\s+/).includes(name) ?? false
  );
}

function verifyScope(
  clean: string,
  code: MidwayInventoryCode,
  make?: string,
  empty = false,
) {
  const selects = [
    ...clean.matchAll(/(<select\b[^>]*>)([\s\S]*?)<\/select>/gi),
  ].filter((match) => classContains(match[1] ?? "", "upullsimpleLocation"));
  const selected = [
    ...(selects[0]?.[2] ?? "").matchAll(
      /(<option\b[^>]*>)([\s\S]*?)<\/option>/gi,
    ),
  ].filter(
    (match) => inventoryHtmlAttribute(match[1] ?? "", "selected") !== null,
  );
  if (
    selects.length !== 1 ||
    selected.length !== 1 ||
    inventoryHtmlAttribute(selected[0]?.[1] ?? "", "value") !== code ||
    text(selected[0]?.[2] ?? "") !==
      (code === "MO38"
        ? "Muncie U-Pull"
        : code === "MO09"
          ? "Liberty U-Pull"
          : "Tulsa U-Pull")
  )
    throw new Error("Midway ignored or changed the selected physical yard");
  if (empty) return;
  const forms = [
    ...clean.matchAll(/(<form\b[^>]*>)([\s\S]*?)<\/form>/gi),
  ].filter((match) => classContains(match[1] ?? "", "iis-upull-search-form"));
  const form = forms[0];
  if (
    forms.length !== 1 ||
    inventoryHtmlAttribute(form?.[1] ?? "", "action") !==
      (make
        ? new URL(midwayMakeInventoryUrl(code, make)).pathname
        : "/inventory/ANY/ANY/") ||
    inventoryHtmlAttribute(form?.[1] ?? "", "method") !== "get"
  )
    throw new Error("Midway unfiltered inventory form changed");
  const inputs = [...(form?.[2] ?? "").matchAll(/<input\b[^>]*>/gi)];
  if (
    inputs.some(
      ([tag]) =>
        !["k", "id", "view", "search"].includes(
          inventoryHtmlAttribute(tag, "name") ?? "",
        ),
    )
  )
    throw new Error(
      "Midway inventory form has an unverified additional filter",
    );
  for (const [name, expected] of [
    ["k", "1"],
    ["id", code],
    ["view", "table"],
    ["search", ""],
  ]) {
    const values = inputs.filter(
      ([tag]) => inventoryHtmlAttribute(tag, "name") === name,
    );
    if (
      values.length !== 1 ||
      inventoryHtmlAttribute(values[0]?.[0] ?? "", "value") !== expected
    )
      throw new Error(
        "Midway inventory is filtered or has mismatched yard scope",
      );
  }
}

export function parseMidwayCatalog(
  html: string,
  code: MidwayInventoryCode,
  make?: string,
  cappedWitness = false,
): MidwayRecord[] {
  const clean = stripInventoryRawText(html);
  if (html.length > 10_000_000 || !/<\/html>\s*$/i.test(clean))
    throw new Error("Midway inventory is oversized or truncated");
  if (
    make &&
    clean.includes("No Results Found. Try Browsing Our Parts Or Search Again")
  ) {
    verifyScope(clean, code, make, true);
    const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)]
      .map((match) => match[1] ?? "")
      .join("\n");
    const makeValues = [
      ...scripts.matchAll(/\bvar\s+setMake\s*=\s*"([^"]+)"/g),
    ].map((match) => match[1]);
    const modelValues = [
      ...scripts.matchAll(/\bvar\s+setModel\s*=\s*"([^"]+)"/g),
    ].map((match) => match[1]);
    const yards = [...scripts.matchAll(/\bvar\s+urgID\s*=\s*"([^"]+)"/g)].map(
      (match) => match[1],
    );
    if (
      makeValues.length !== 1 ||
      makeValues[0] !== make.replace(" ", "_").replace("/", ".") ||
      modelValues.length !== 1 ||
      modelValues[0] !== "ANY" ||
      !yards.length ||
      yards.some((yard) => yard !== code) ||
      /IISUpullTable/.test(clean)
    )
      throw new Error(
        "Midway empty response does not prove its selected make and yard",
      );
    return [];
  }
  if (
    !clean
      .replace(/<[^>]*>/g, " ")
      .replace(/&#0*39;|&apos;/gi, "'")
      .replace(/\s+/g, " ")
      .includes(
        "Some vehicles may not show parts available if we haven't parted them out yet.",
      )
  )
    throw new Error("Midway active donor inventory statement changed");
  verifyScope(clean, code, make);
  for (const [tag] of clean.matchAll(/<a\b[^>]*>/gi)) {
    const href = inventoryHtmlAttribute(tag, "href");
    const url = href === null ? null : URL.parse(text(href), MIDWAY_ORIGIN);
    if (
      url?.origin === MIDWAY_ORIGIN &&
      url.pathname.startsWith("/inventory/") &&
      ["page", "paged", "offset", "cursor", "limit"].some((key) =>
        url.searchParams.has(key),
      )
    )
      throw new Error(
        "Midway inventory introduced an unverified page continuation",
      );
  }
  const inline = [
    ...html
      .replace(/<!--[\s\S]*?-->/g, "")
      .matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi),
  ];
  if (
    inline.some((match) =>
      /IISUpullTable|bootstrapTable|sidePagination|serverSide/i.test(
        match[1] ?? "",
      ),
    ) ||
    !html.includes("bootstrap-table@1.21.4/dist/bootstrap-table.min.js")
  )
    throw new Error("Midway inline pagination contract changed");
  const openings = [...clean.matchAll(/<table\b[^>]*>/gi)].filter(([tag]) =>
    classContains(tag, "IISUpullTable"),
  );
  const tables = [
    ...clean.matchAll(/(<table\b[^>]*>)([\s\S]*?)<\/table>/gi),
  ].filter((match) => classContains(match[1] ?? "", "IISUpullTable"));
  const table = tables[0];
  if (
    openings.length !== 1 ||
    tables.length !== 1 ||
    !table?.[1] ||
    table[2] === undefined
  )
    throw new Error("Expected one complete Midway table");
  const allowed = new Set([
    "data-toggle",
    "data-search",
    "data-pagination",
    "data-side-pagination",
  ]);
  const attributes = [...table[1].matchAll(/\b(data-[\w-]+)(?=\s|=|>)/gi)];
  if (
    attributes.some((match) => !allowed.has((match[1] ?? "").toLowerCase())) ||
    inventoryHtmlAttribute(table[1], "data-toggle") !== "table" ||
    inventoryHtmlAttribute(table[1], "data-pagination") !== "true" ||
    ![null, "client"].includes(
      inventoryHtmlAttribute(table[1], "data-side-pagination"),
    )
  )
    throw new Error("Midway remote or changed table pagination is unsupported");
  const { head, body } = inventoryTableSections(table[2]);
  const headers = [
    "Image",
    "Year",
    "Make",
    "Model",
    "Row",
    "Date",
    "Vin",
    "Stock #",
    "Fresh Set",
  ];
  const headingRow = /^\s*<tr\b[^>]*>([\s\S]*?)<\/tr>\s*$/i.exec(head)?.[1];
  const headings = [
    ...(headingRow ?? "").matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/gi),
  ];
  if (
    headings.length !== headers.length ||
    headings.some((match, index) => text(match[1] ?? "") !== headers[index]) ||
    headingRow?.replace(/<th\b[^>]*>[\s\S]*?<\/th>/gi, "").trim()
  )
    throw new Error("Midway inventory headings changed");
  const rows = [...body.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)];
  if (
    (!rows.length && make === undefined) ||
    rows.length > 10_000 ||
    body.replace(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi, "").trim()
  )
    throw new Error("Midway inventory rows are empty or incomplete");
  // The native broad view can silently stop at 500 rows. A published search
  // recovered older donors beyond a stable 500-row Tulsa capture.
  if (rows.length >= 500 && !cappedWitness)
    throw new Error(
      "Midway inventory reached the observed 500-row result boundary; completeness cannot be verified. Previously published inventory is preserved. Validate complete native traversal before retrying.",
    );
  const records = rows.map((match) => {
    const row = match[1] ?? "";
    const cells = [...row.matchAll(/<(th|td)\b[^>]*>([\s\S]*?)<\/\1>/gi)];
    if (
      cells.length !== 9 ||
      cells.some(
        (cell, index) =>
          cell[1]?.toLowerCase() !== (index === 0 ? "th" : "td") ||
          /<\/?(?:tr|td|th)\b/i.test(cell[2] ?? ""),
      ) ||
      row.replace(/<(th|td)\b[^>]*>[\s\S]*?<\/\1>/gi, "").trim()
    )
      throw new Error("Midway donor cells are incomplete or reordered");
    const value = (index: number) => text(cells[index]?.[2] ?? "");
    const optionalValue = (index: number) => {
      // Structure was validated above. An undecodable optional scalar is
      // unverified metadata, never a reason to discard the native donor.
      try {
        return value(index);
      } catch {
        return "";
      }
    };
    return {
      imageUrl:
        [...(cells[0]?.[2] ?? "").matchAll(/<img\b[^>]*>/gi)]
          .filter(([tag]) => classContains(tag, "main-vehicle-img"))
          .map(([tag]) =>
            midwayVehiclePhoto(inventoryHtmlAttribute(tag, "src")),
          )
          .find((url) => url !== null) ?? null,
      year: value(1),
      make: value(2),
      model: value(3),
      row: optionalValue(4),
      arrived: optionalValue(5),
      vin: value(6),
      stock: optionalValue(7),
    };
  });
  if (make && records.some((record) => record.make !== make))
    throw new Error("Midway ignored its selected make control");
  return records;
}

/** NISSAN occurs twice in the native menu; query each distinct value once. */
export function parseMidwayMakeDirectory(
  html: string,
  code: MidwayInventoryCode,
): string[] {
  const clean = stripInventoryRawText(html);
  if (!/<\/html>\s*$/i.test(clean))
    throw new Error("Midway make directory is truncated");
  verifyScope(clean, code);
  const menus = [
    ...clean.matchAll(/(<select\b[^>]*>)([\s\S]*?)<\/select>/gi),
  ].filter((match) => classContains(match[1] ?? "", "upullsimpleMake"));
  if (menus.length !== 1)
    throw new Error("Midway make directory is missing or ambiguous");
  const values = [
    ...(menus[0]?.[2] ?? "").matchAll(/<option\b([^>]*)>[\s\S]*?<\/option>/gi),
  ]
    .map((match) => inventoryHtmlAttribute(match[1] ?? "", "value"))
    .filter((value): value is string => value !== null);
  if (!values.includes("ANY"))
    throw new Error("Midway make directory lost its unfiltered choice");
  const makes = [...new Set(values.filter((value) => value !== "ANY"))];
  if (
    !makes.length ||
    makes.length > 100 ||
    makes.some((make) => !/^[A-Z0-9 /-]{1,50}$/.test(make))
  )
    throw new Error("Midway make directory has unsupported controls");
  return makes;
}
