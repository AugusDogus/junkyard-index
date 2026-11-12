import { createHash } from "node:crypto";
import {
  inventoryHtmlAttribute,
  inventoryTableSections,
  stripInventoryRawText,
} from "./inventory-html";
import {
  RIGHTWAY_INVENTORY_URL,
  RIGHTWAY_ORIGIN,
  RIGHTWAY_SCRIPT_PATH,
  RIGHTWAY_YARD,
} from "./rightway-yard-metadata";

export interface RightwayRecord {
  dateAdded: string;
  year: string;
  make: string;
  model: string;
  stock: string;
  color: string;
  vin: string;
  nativeUrl: string;
}

const columns = [
  ["inventory_date_added", "Date Added"],
  ["inventory_year", "Year"],
  ["inventory_make", "Make"],
  ["inventory_model", "Model"],
  ["inventory_number", "Stock #"],
  ["inventory_fob", "Color"],
  ["inventory_serial", "VIN"],
] as const;

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
          throw new Error("Unsupported Rightway entity " + entity);
        return value;
      }
      const hex = /^#x/i.test(key);
      const point = Number.parseInt(key.slice(hex ? 2 : 1), hex ? 16 : 10);
      if (
        point <= 0 ||
        point > 0x10ffff ||
        (point >= 0xd800 && point <= 0xdfff)
      )
        throw new Error("Invalid Rightway character reference");
      return String.fromCodePoint(point);
    },
  );
}
const text = (raw: string) =>
  decode(raw.replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
const classes = (tag: string) =>
  (inventoryHtmlAttribute(tag, "class") ?? "").split(/\s+/);
function document(raw: string): string {
  if (Buffer.byteLength(raw) > 2_000_000 || !/<\/html\s*>\s*$/i.test(raw))
    throw new Error("Rightway HTML is oversized or truncated");
  return stripInventoryRawText(raw);
}

export function parseRightwayYard(raw: string): typeof RIGHTWAY_YARD {
  const html = document(raw);
  const plain = text(html);
  const links = [...html.matchAll(/<a\b[^>]*>/gi)].map(([tag]) =>
    inventoryHtmlAttribute(tag, "href"),
  );
  if (
    !plain.includes("Rightway Auto Recycling is a you-pull-it yard") ||
    !plain.includes("Vehicle List Inventory changes daily") ||
    !plain.includes(
      "We are located at 7945 TN 100 W. Decaturville, TN 38329",
    ) ||
    !plain.includes(RIGHTWAY_YARD.phone) ||
    !links.includes(RIGHTWAY_INVENTORY_URL)
  )
    throw new Error(
      "Official Rightway active yard identity changed; inspect the native address, phone and inventory links before retrying",
    );
  return RIGHTWAY_YARD;
}

export function parseRightwayPriceList(raw: string): string | null {
  const url = RIGHTWAY_ORIGIN + "/price-list/";
  return [...document(raw).matchAll(/<a\b[^>]*>/gi)].some(
    ([tag]) => inventoryHtmlAttribute(tag, "href") === url,
  )
    ? url
    : null;
}

/** The saved native plugin initializes the inline table with DataTable() only.
 * Reinspect enumeration before accepting a new plugin body or version.
 */
export function validateRightwayPaginationScript(raw: string): void {
  if (
    createHash("sha256").update(raw).digest("hex") !==
    "3768ee331f91c20b5eb2ff1cbb9f7089a70c5cecf814ff66d71fad05073a7045"
  )
    throw new Error(
      "Rightway pagination script changed; inspect complete unfiltered traversal before retrying",
    );
}

export function parseRightwayCatalog(raw: string): RightwayRecord[] {
  const html = document(raw);
  const plain = text(html);
  if (
    !plain.includes("check which parts are still available on each vehicle") ||
    !plain.includes("7945 TN-100 Decaturville, TN 38329") ||
    !plain.includes(RIGHTWAY_YARD.phone)
  )
    throw new Error(
      "Rightway inventory no longer confirms the verified active yard",
    );
  if (
    /<form\b/i.test(html) ||
    /\brel\s*=\s*["']?next\b|\bclass\s*=\s*["'][^"']*\b(?:pagination|page-numbers)\b/i.test(
      html,
    )
  )
    throw new Error(
      "Rightway exposes an unprocessed filter or pagination control",
    );
  for (const [tag] of html.matchAll(/<a\b[^>]*>/gi)) {
    const href = inventoryHtmlAttribute(tag, "href");
    const url =
      href === null ? null : URL.parse(decode(href), RIGHTWAY_INVENTORY_URL);
    if (
      url?.origin === RIGHTWAY_ORIGIN &&
      ([...url.searchParams.keys()].some((key) =>
        /^(?:page|paged|offset|inventory_page)$/i.test(key),
      ) ||
        (url.pathname === "/vehicle-search/" &&
          [...url.searchParams.keys()].some((key) => key !== "inventory_id")))
    )
      throw new Error(
        "Rightway exposes an unprocessed filter or pagination link",
      );
  }
  const scripts = [
    ...raw
      .replace(/<!--[\s\S]*?-->/g, "")
      .matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi),
  ];
  const inventoryScripts = scripts.filter(
    (script) =>
      inventoryHtmlAttribute(script[1] ?? "", "id") === "wpinventory-common-js",
  );
  if (
    inventoryScripts.length !== 1 ||
    inventoryHtmlAttribute(inventoryScripts[0]?.[1] ?? "", "src") !==
      RIGHTWAY_ORIGIN + RIGHTWAY_SCRIPT_PATH ||
    scripts.some(
      (script) =>
        !inventoryHtmlAttribute(script[1] ?? "", "src") &&
        /\b(?:DataTable|dataTable|serverSide)\b|wpinventory_loop/.test(
          script[2] ?? "",
        ),
    )
  )
    throw new Error("Rightway inline pagination contract changed");
  const tables = [
    ...html.matchAll(/(<table\b[^>]*>)([\s\S]*?)<\/table\s*>/gi),
  ].filter((match) => classes(match[1] ?? "").includes("wpinventory_loop"));
  const table = tables[0];
  const tableClasses = classes(table?.[1] ?? "");
  if (
    tables.length !== 1 ||
    !table?.[2] ||
    !tableClasses.includes("wpinventory_loop_all") ||
    !tableClasses.includes("wpinventory_loop_all_table") ||
    [...html.matchAll(/<table\b[^>]*>/gi)].filter(([tag]) =>
      classes(tag).includes("wpinventory_loop"),
    ).length !== 1
  )
    throw new Error(
      "Expected one complete unfiltered Rightway inventory table",
    );
  const { head, body } = inventoryTableSections(table[2]);
  const headingRow = /^\s*<tr\b[^>]*>([\s\S]*?)<\/tr\s*>\s*$/i.exec(head)?.[1];
  const headings = [
    ...(headingRow ?? "").matchAll(/(<th\b[^>]*>)([\s\S]*?)<\/th\s*>/gi),
  ];
  if (
    headings.length !== columns.length ||
    headings.some((heading, index) => {
      const expected = columns[index];
      return (
        !expected ||
        !classes(heading[1] ?? "").includes(expected[0]) ||
        text(heading[2] ?? "") !== expected[1]
      );
    }) ||
    headingRow?.replace(/<th\b[^>]*>[\s\S]*?<\/th\s*>/gi, "").trim()
  )
    throw new Error("Rightway inventory columns changed");
  const rows = [...body.matchAll(/(<tr\b[^>]*>)([\s\S]*?)<\/tr\s*>/gi)];
  if (
    rows.length === 0 ||
    rows.length > 10_000 ||
    body.replace(/<tr\b[^>]*>[\s\S]*?<\/tr\s*>/gi, "").trim()
  )
    throw new Error(
      "Rightway inventory rows are empty, oversized or incomplete",
    );
  return rows.map((row) => {
    const rowClasses = classes(row[1] ?? "");
    const ids = rowClasses.flatMap(
      (name) => /^wpinventoryitem-([1-9]\d{0,9})$/.exec(name)?.[1] ?? [],
    );
    if (!rowClasses.includes("wpinventory_item") || ids.length !== 1)
      throw new Error("Rightway donor row lacks one native inventory identity");
    const parts = (row[2] ?? "").trim().split(/(?=<td\b)/i);
    if (parts.length !== columns.length)
      throw new Error("Rightway donor cell count changed");
    let nativeUrl: string | null = null;
    const fields = parts.map((part, index) => {
      const match = /^(<td\b[^>]*>)([\s\S]*)$/i.exec(part);
      const expected = columns[index];
      const content = match?.[2]?.replace(/<\/td\s*>\s*$/i, "").trim();
      if (
        !match?.[1] ||
        !expected ||
        !classes(match[1]).includes(expected[0]) ||
        content === undefined ||
        /<\/?(?:td|th|tr)\b/i.test(content)
      )
        throw new Error(
          "Rightway donor cells are missing, reordered or nested",
        );
      // Native td end tags are implicit. Read each cell's own complete anchor,
      // never a repaired DOM cell's descendants from subsequent columns.
      if (content === "") return "";
      const anchor = /^(<a\b[^>]*>)([\s\S]*?)<\/a\s*>\s*$/i.exec(content);
      const href = inventoryHtmlAttribute(anchor?.[1] ?? "", "href");
      const url =
        href === null ? null : URL.parse(decode(href), RIGHTWAY_ORIGIN);
      if (
        !anchor ||
        /<\/?a\b/i.test(anchor[2] ?? "") ||
        !url ||
        url.origin !== RIGHTWAY_ORIGIN ||
        url.username ||
        url.password ||
        url.hash ||
        url.pathname !== "/vehicle-search/" ||
        url.searchParams.size !== 1 ||
        url.searchParams.get("inventory_id") !== ids[0] ||
        (nativeUrl !== null && nativeUrl !== url.href)
      )
        throw new Error(
          "Rightway donor cells do not share their native inventory URL",
        );
      nativeUrl = url.href;
      const value = text(anchor[2] ?? "");
      if (value.length > 300)
        throw new Error("Rightway donor field exceeds its inspected bound");
      return value;
    });
    if (nativeUrl === null)
      throw new Error("Rightway donor has no published native URL");
    return {
      dateAdded: fields[0] ?? "",
      year: fields[1] ?? "",
      make: fields[2] ?? "",
      model: fields[3] ?? "",
      stock: fields[4] ?? "",
      color: fields[5] ?? "",
      vin: fields[6] ?? "",
      nativeUrl,
    };
  });
}
