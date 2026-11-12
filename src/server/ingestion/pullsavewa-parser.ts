import {
  inventoryHtmlAttribute,
  inventoryTableSections,
  stripInventoryRawText,
} from "./inventory-html";
import type { PullsavewaYard } from "./pullsavewa-yard-metadata";
import { PullsavewaRecord } from "./pullsavewa-record";
export type { PullsavewaRecord } from "./pullsavewa-record";

export const PULLSAVEWA_DISCLAIMER =
  "Since we are continuously updating our inventory, the information you are viewing is approximately 90% accurate. Pull & Save Auto Parts cannot confirm or deny locations or parts availability.";
export const PULLSAVEWA_MAX_RECORDS = 10_000;
const fields = [
  "view",
  "Image",
  "Stock_Ticket",
  "Row",
  "Date_Set",
  "Vin",
  "Year",
  "Make",
  "Model",
];
const labels = [
  "",
  "Image",
  "Stock Ticket",
  "Row",
  "Date Set",
  "Vin",
  "Year",
  "Make",
  "Model",
];

export interface PullsavewaPage {
  records: PullsavewaRecord[];
  total: number | null;
  start: number | null;
  terminalUrl: string | null;
}

function text(raw: string): string {
  const named = new Map([
    ["amp", "&"],
    ["lt", "<"],
    ["gt", ">"],
    ["quot", '"'],
    ["apos", "'"],
    ["nbsp", " "],
    ["copy", "©"],
  ]);
  return raw
    .replace(/<[^>]*>/g, " ")
    .replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (entity: string, key: string) => {
      if (!key.startsWith("#")) {
        const value = named.get(key.toLowerCase());
        if (value === undefined)
          throw new Error("Unsupported Pull & Save entity " + entity);
        return value;
      }
      const hex = key.slice(0, 2).toLowerCase() === "#x";
      const point = Number.parseInt(key.slice(hex ? 2 : 1), hex ? 16 : 10);
      if (
        point <= 0 ||
        point > 0x10ffff ||
        (point >= 0xd800 && point <= 0xdfff)
      )
        throw new Error("Invalid Pull & Save character reference");
      return String.fromCodePoint(point);
    })
    .replace(/\s+/g, " ")
    .trim();
}

function namedCells(row: string, cell: "th" | "td"): string[] {
  const pattern = new RegExp(
    `<${cell}\\b[^>]*>[\\s\\S]*?<\\/${cell}\\s*>`,
    "gi",
  );
  const matches = [...row.matchAll(pattern)];
  if (matches.length !== fields.length || row.replace(pattern, "").trim())
    throw new Error("Pull & Save inventory cell count changed");
  return matches.map(([raw], index) => {
    const opening = raw.slice(0, raw.indexOf(">") + 1);
    const value = raw
      .slice(opening.length)
      .replace(new RegExp(`<\\/${cell}\\s*>$`, "i"), "");
    if (
      inventoryHtmlAttribute(opening, "data-name") !== fields[index] ||
      /<\/?(?:tr|th|td)\b/i.test(value)
    )
      throw new Error(
        "Pull & Save inventory fields are reordered or incomplete",
      );
    return value;
  });
}

function optionalText(raw: string): string | null {
  try {
    return text(raw);
  } catch {
    // Unreadable optional metadata does not invalidate native required fields.
    return null;
  }
}

function detailUrl(cell: string, stock: string, yard: PullsavewaYard): string {
  const links = [...cell.matchAll(/<a\b[^>]*>/gi)];
  const href = links[0] ? inventoryHtmlAttribute(links[0][0], "href") : null;
  const url = href === null ? null : URL.parse(text(href), yard.inventoryUrl);
  const entries = url ? [...url.searchParams.entries()] : [];
  const nativeStock = url?.searchParams.get("Stock_Ticket");
  if (
    links.length !== 1 ||
    !url ||
    url.origin !== "https://newautopart.net" ||
    url.pathname !==
      `/includes/pullandsave/${yard.code}/yard_locationsview.php` ||
    url.username ||
    url.password ||
    url.hash ||
    entries.length !== 2 ||
    url.searchParams.get("showdetail") !== "" ||
    !nativeStock ||
    !/^[A-Z0-9]{1,30}$/i.test(nativeStock) ||
    (PullsavewaRecord.stockNumber(stock) !== null && stock !== nativeStock)
  )
    throw new Error(
      "Pull & Save donor destination or native stock ownership changed",
    );
  return url.href;
}

function photoReference(
  cell: string,
  detailsUrl: string,
  stock: string,
  yard: PullsavewaYard,
): string | null {
  try {
    if (detailUrl(cell, stock, yard) !== detailsUrl) return null;
    const images = [...cell.matchAll(/<img\b[^>]*>/gi)];
    const tag = images[0]?.[0];
    if (images.length !== 1 || tag === undefined) return null;
    const anchored = /<a\b[^>]*>([\s\S]*?)<\/a\s*>/i.exec(cell)?.[1];
    if (anchored === undefined || !anchored.includes(tag)) return null;
    const raw =
      inventoryHtmlAttribute(tag, "data-src") ??
      inventoryHtmlAttribute(tag, "src");
    return raw === null || /[<>\s]/.test(raw) ? null : optionalText(raw);
  } catch {
    // Ambiguous, malformed or foreign photo controls supply no usable photo.
    return null;
  }
}

export function parsePullsavewaPage(
  html: string,
  yard: PullsavewaYard,
  kind: "first" | "all" | "last",
): PullsavewaPage {
  if (html.length > 4 * 1024 * 1024 || !/<\/html>\s*$/i.test(html))
    throw new Error("Pull & Save page is oversized or truncated");
  const clean = stripInventoryRawText(html);
  const disclaimers = [
    ...clean.matchAll(
      /Since we are continuously updating[\s\S]*?locations or parts availability\./g,
    ),
  ];
  if (
    disclaimers.length !== 1 ||
    text(disclaimers[0]?.[0] ?? "") !== PULLSAVEWA_DISCLAIMER
  )
    throw new Error("Pull & Save current inventory disclaimer changed");
  const filters = [
    ...html.matchAll(/fyard_locationslistsrch\.filterList\s*=\s*([^;]+);/g),
  ];
  const searches = [
    ...clean.matchAll(/(<form\b[^>]*>)([\s\S]*?)<\/form\s*>/gi),
  ].filter(
    (m) =>
      inventoryHtmlAttribute(m[1] ?? "", "name") === "fyard_locationslistsrch",
  );
  const search = searches[0];
  const searchInputs = [...(search?.[2] ?? "").matchAll(/<input\b[^>]*>/gi)];
  const expectedSearch = new Map([
    ["cmd", "search"],
    ["t", "yard_locations"],
    ["psearch", ""],
    ["psearchtype", ""],
  ]);
  if (
    filters.length !== 1 ||
    filters[0]?.[1]?.trim() !== "null" ||
    searches.length !== 1 ||
    inventoryHtmlAttribute(search?.[1] ?? "", "action") !==
      "yard_locationslist.php" ||
    searchInputs.length !== expectedSearch.size ||
    new Set(searchInputs.map(([tag]) => inventoryHtmlAttribute(tag, "name")))
      .size !== expectedSearch.size ||
    searchInputs.some(
      ([tag]) =>
        expectedSearch.get(inventoryHtmlAttribute(tag, "name") ?? "") !==
        inventoryHtmlAttribute(tag, "value"),
    )
  )
    throw new Error(
      "Pull & Save native search/filter scope is narrowed or changed",
    );
  const openings = [...clean.matchAll(/<table\b[^>]*>/gi)].filter(
    ([tag]) => inventoryHtmlAttribute(tag, "id") === "tbl_yard_locationslist",
  );
  const tables = [
    ...clean.matchAll(/(<table\b[^>]*>)([\s\S]*?)<\/table\s*>/gi),
  ].filter(
    (m) =>
      inventoryHtmlAttribute(m[1] ?? "", "id") === "tbl_yard_locationslist",
  );
  const content = tables[0]?.[2];
  if (openings.length !== 1 || tables.length !== 1 || content === undefined)
    throw new Error("Expected one complete Pull & Save inventory table");
  const { head, body } = inventoryTableSections(content);
  const heading = /^\s*<tr\b[^>]*>([\s\S]*?)<\/tr\s*>\s*$/i.exec(head)?.[1];
  if (
    heading === undefined ||
    namedCells(heading, "th").some((value, i) => text(value) !== labels[i])
  )
    throw new Error("Pull & Save inventory headings changed");
  const rowPattern = /(<tr\b[^>]*>)([\s\S]*?)<\/tr\s*>/gi;
  const rows = [...body.matchAll(rowPattern)];
  if (
    !rows.length ||
    rows.length > PULLSAVEWA_MAX_RECORDS ||
    body.replace(rowPattern, "").trim()
  )
    throw new Error(
      "Pull & Save inventory rows are empty, oversized or incomplete",
    );
  const records = rows.map((match, i): PullsavewaRecord => {
    const tag = match[1] ?? "";
    if (
      inventoryHtmlAttribute(tag, "data-rowindex") !== String(i + 1) ||
      inventoryHtmlAttribute(tag, "id") !== `r${i + 1}_yard_locations` ||
      inventoryHtmlAttribute(tag, "data-rowtype") !== "1"
    )
      throw new Error("Pull & Save native row coverage changed");
    const raw = namedCells(match[2] ?? "", "td");
    const values = raw.map((value, index) =>
      index < 2 ? "" : index < 5 ? (optionalText(value) ?? "") : text(value),
    );
    const stock = values[2] ?? "";
    const detailsUrl = detailUrl(raw[0] ?? "", stock, yard);
    return {
      stock,
      row: values[3] ?? "",
      date: values[4] ?? "",
      vin: values[5] ?? "",
      year: values[6] ?? "",
      make: values[7] ?? "",
      model: values[8] ?? "",
      detailsUrl,
      nativeImageUrl: photoReference(raw[1] ?? "", detailsUrl, stock, yard),
    };
  });
  if (
    new Set(
      records.map((record) =>
        new URL(record.detailsUrl).searchParams.get("Stock_Ticket"),
      ),
    ).size !== records.length
  )
    throw new Error(
      "Pull & Save catalog has duplicate native stock identities",
    );
  const forms = [
    ...clean.matchAll(/(<form\b[^>]*>)([\s\S]*?)<\/form\s*>/gi),
  ].filter(
    (match) =>
      inventoryHtmlAttribute(match[1] ?? "", "name") === "ew-pager-form",
  );
  if (forms.length !== 2)
    throw new Error("Pull & Save native pager forms changed");
  const ranges: string[] = [];
  const lastLinks: string[] = [];
  let forward = 0;
  for (const form of forms) {
    const tag = form[1] ?? "";
    const method = inventoryHtmlAttribute(tag, "method");
    const inner = form[2] ?? "";
    if (
      inventoryHtmlAttribute(tag, "action") !== "yard_locationslist.php" ||
      (method !== null && method.toLowerCase() !== "get")
    )
      throw new Error(
        "Pull & Save native pager is no longer the published GET control",
      );
    if (kind === "all") {
      if (inner.trim())
        throw new Error(
          "Pull & Save ALL request retained pagination; complete inventory is unproved",
        );
      continue;
    }
    const range = [...text(inner).matchAll(/Records (\d+) to (\d+) of (\d+)/g)];
    if (range.length !== 1)
      throw new Error("Pull & Save native record census is missing");
    ranges.push(range[0]?.[0] ?? "");
    const selectors = [
      ...inner.matchAll(/(<select\b[^>]*>)([\s\S]*?)<\/select\s*>/gi),
    ].filter(
      (m) => inventoryHtmlAttribute(m[1] ?? "", "name") === "recperpage",
    );
    const selector = selectors[0];
    if (
      selectors.length !== 1 ||
      inventoryHtmlAttribute(selector?.[1] ?? "", "onchange") !==
        "this.form.submit();" ||
      !/<option\b[^>]*value="ALL"[^>]*>All<\/option>/i.test(selector?.[2] ?? "")
    )
      throw new Error("Pull & Save native ALL selector changed");
    for (const [anchor] of inner.matchAll(/<a\b[^>]*>/gi)) {
      const title = inventoryHtmlAttribute(anchor, "title");
      const href = inventoryHtmlAttribute(anchor, "href");
      if ((title === "Next" || title === "Last") && href !== null) {
        forward++;
        if (!/^yard_locationslist\.php\?start=[1-9]\d*$/.test(href))
          throw new Error("Pull & Save pager destination changed");
        if (title === "Last")
          lastLinks.push(new URL(href, yard.inventoryUrl).href);
      }
    }
  }
  if (kind === "all")
    return { records, total: null, start: null, terminalUrl: null };
  const match = /^Records (\d+) to (\d+) of (\d+)$/.exec(ranges[0] ?? "");
  const start = Number(match?.[1]);
  const end = Number(match?.[2]);
  const total = Number(match?.[3]);
  const terminalStart = Math.floor((total - 1) / 20) * 20 + 1;
  const terminalUrl =
    total > 20 ? yard.inventoryUrl + "?start=" + terminalStart : null;
  if (
    ranges[0] !== ranges[1] ||
    !Number.isSafeInteger(total) ||
    total < 1 ||
    total > PULLSAVEWA_MAX_RECORDS ||
    start !== (kind === "first" ? 1 : terminalStart) ||
    end !== Math.min(start + 19, total) ||
    records.length !== end - start + 1 ||
    (kind === "last" && forward !== 0) ||
    (kind === "first" &&
      (total > 20
        ? lastLinks.length !== 2 ||
          lastLinks.some((url) => url !== terminalUrl) ||
          forward !== 4
        : forward !== 0))
  )
    throw new Error(
      "Pull & Save pagination census or terminal control changed",
    );
  return { records, start, total, terminalUrl };
}

export function validatePullsavewaSnapshot(
  first: PullsavewaPage,
  all: PullsavewaPage,
  last: PullsavewaPage,
): PullsavewaRecord[] {
  if (
    first.total !== all.records.length ||
    first.total !== last.total ||
    last.start !== Math.floor((all.records.length - 1) / 20) * 20 + 1
  )
    throw new Error(
      "Pull & Save complete table differs from the fresh native record census",
    );
  // Optional photo controls may become unusable independently of donor scope.
  const controlKey = (record: PullsavewaRecord) =>
    JSON.stringify([
      record.stock,
      record.row,
      record.date,
      record.vin,
      record.year,
      record.make,
      record.model,
      record.detailsUrl,
    ]);
  const native = new Map(
    all.records.map((record) => [record.detailsUrl, controlKey(record)]),
  );
  if (
    [...first.records, ...last.records].some(
      (record) => native.get(record.detailsUrl) !== controlKey(record),
    )
  )
    throw new Error(
      "Pull & Save first/terminal native controls differ from ALL; inventory changed or is partial",
    );
  return all.records;
}
