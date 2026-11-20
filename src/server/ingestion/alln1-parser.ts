import { createHash } from "node:crypto";
import {
  inventoryHtmlAttribute,
  inventoryTableSections,
  stripInventoryRawText,
} from "./inventory-html";
import {
  ALLN1_MAX_PAGES,
  ALLN1_PAGE_SIZE,
  ALLN1_TENANT,
  type Alln1Tenant,
  alln1PageNumber,
  alln1WithoutCacheBust,
} from "./alln1-yard-metadata";

export interface Alln1Record {
  year: string;
  make: string;
  model: string;
  position: string;
  setDate: string;
  vin: string;
  stock: string;
  freshSet: string;
  imageUrl: string | null;
}
export const alln1Hash = (value: unknown): string =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
export function alln1OptionalText(raw: string): string | null {
  const value = raw.trim();
  return !value ||
    value.length > 100 ||
    /^(?:other|unknown|n\/?a|none|null|undefined|[-?]+|0+)$/i.test(value)
    ? null
    : value;
}
export function alln1Stock(raw: string): string | null {
  const value = alln1OptionalText(raw);
  return value && /^[A-Z0-9][A-Z0-9-]{1,39}$/i.test(value) ? value : null;
}
export function alln1SourceDate(raw: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const date = new Date(raw + "T00:00:00.000Z");
  return Number.isFinite(date.getTime()) &&
    date.toISOString().slice(0, 10) === raw
    ? raw
    : null;
}
function text(raw: string): string {
  const named = new Map([
    ["amp", "&"],
    ["nbsp", " "],
    ["quot", '"'],
    ["apos", "'"],
    ["lt", "<"],
    ["gt", ">"],
    ["raquo", "»"],
    ["laquo", "«"],
    ["ndash", "\u2013"],
    ["mdash", "\u2014"],
  ]);
  return raw
    .replace(/<[^>]*>/g, " ")
    .replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (entity: string, key: string) => {
      if (!key.startsWith("#")) {
        const value = named.get(key.toLowerCase());
        if (value === undefined)
          throw new Error("Unsupported All-N-1 inventory entity " + entity);
        return value;
      }
      const hex = /^#x/i.test(key);
      const point = Number.parseInt(key.slice(hex ? 2 : 1), hex ? 16 : 10);
      if (
        point <= 0 ||
        point > 0x10ffff ||
        (point >= 0xd800 && point <= 0xdfff)
      )
        throw new Error("Invalid All-N-1 character reference");
      return String.fromCodePoint(point);
    })
    .replace(/\s+/g, " ")
    .trim();
}
const attr = (tag: string, name: string) => {
  const raw = inventoryHtmlAttribute(tag, name);
  return raw === null ? null : text(raw);
};
const hasClass = (tag: string, name: string) =>
  (attr(tag, "class") ?? "").split(/\s+/).includes(name);
function complete(raw: string): void {
  if (
    Buffer.byteLength(raw) > 4 * 1024 * 1024 ||
    !/<\/html>\s*$/i.test(stripInventoryRawText(raw))
  )
    throw new Error("All-N-1 HTML is oversized or truncated");
}
export function parseAlln1Owner(
  raw: string,
  tenant: Alln1Tenant = ALLN1_TENANT,
): string {
  complete(raw);
  const clean = stripInventoryRawText(raw);
  const body = clean.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");
  const descriptions = [...clean.matchAll(/<meta\b[^>]*>/gi)].filter(
    ([tag]) => attr(tag, "name") === "description",
  );
  if (
    !tenant.ownerClaims.every((claim) => body.includes(claim)) ||
    (tenant.ownerPhoneDigits !== null &&
      !body.replace(/\D/g, "").includes(tenant.ownerPhoneDigits)) ||
    descriptions.length !== 1 ||
    !attr(descriptions[0]?.[0] ?? "", "content")?.includes(
      tenant.ownerDescription,
    )
  )
    throw new Error(
      "All-N-1 physical ownership, address, phone or self-service statement changed",
    );
  return alln1Hash({
    yard: tenant.yard.code,
    address: tenant.yard.address,
    phone: tenant.yard.phone,
    selfService: true,
  });
}
function verifyForm(clean: string, nonce: string | null, search: string): void {
  const forms = [
    ...clean.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form\s*>/gi),
  ].filter((m) => hasClass(m[1] ?? "", "iis-upull-search-form"));
  const form = forms[0];
  if (
    forms.length !== 1 ||
    attr(form?.[1] ?? "", "method") !== "get" ||
    attr(form?.[1] ?? "", "action") !== "/inventory/ANY/ANY/"
  )
    throw new Error("All-N-1 published unfiltered GET search form changed");
  const inputs = [...(form?.[2] ?? "").matchAll(/<input\b[^>]*>/gi)];
  // A cache-busted request is rendered with its own nonce reflected as a
  // hidden field. Any other cb value is another request's cached page.
  const fields: [string, string][] = [
    ["k", "1"],
    ["view", "table"],
    ["search", search],
  ];
  if (nonce !== null) fields.push(["cb", nonce]);
  if (inputs.length !== fields.length)
    throw new Error("All-N-1 search form introduced an unverified selector");
  for (const [name, value] of fields) {
    const matches = inputs.filter(([tag]) => attr(tag, "name") === name);
    if (matches.length !== 1 || attr(matches[0]?.[0] ?? "", "value") !== value)
      throw new Error(
        "All-N-1 inventory search is filtered or changed its native fields",
      );
  }
}
interface PageLink {
  label: string;
  page: number;
  url: string;
  active: boolean;
}
function pagination(
  clean: string,
  page: number,
  tenant: Alln1Tenant,
  nonce: string | null,
) {
  const navs = [
    ...clean.matchAll(/<nav\b([^>]*)>([\s\S]*?)<\/nav\s*>/gi),
  ].filter((m) => hasClass(m[1] ?? "", "iis-upull-pagination-wrapper"));
  if (navs.length !== 2)
    throw new Error(
      "All-N-1 must publish two agreeing complete pagination controls",
    );
  const controls = navs.map((nav) =>
    [...(nav[2] ?? "").matchAll(/<li\b([^>]*)>([\s\S]*?)<\/li\s*>/gi)].map(
      (li): PageLink => {
        const links = [
          ...(li[2] ?? "").matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi),
        ];
        const link = links[0];
        const href = attr(link?.[1] ?? "", "href");
        const url = href ? new URL(href, tenant.origin).href : "";
        const target = alln1PageNumber(url, tenant, nonce);
        if (links.length !== 1 || target === null)
          throw new Error(
            "All-N-1 pagination contains a foreign, filtered or unsupported continuation",
          );
        return {
          label: text(link?.[2] ?? ""),
          page: target,
          url: nonce === null ? url : alln1WithoutCacheBust(url),
          active: hasClass(li[1] ?? "", "active"),
        };
      },
    ),
  );
  if (JSON.stringify(controls[0]) !== JSON.stringify(controls[1]))
    throw new Error("All-N-1 pagination controls disagree");
  const links = controls[0] ?? [];
  const numbered = links.filter((link) => /^\d+$/.test(link.label));
  const lastPage = Math.max(0, ...numbered.map((link) => link.page));
  const current = links.filter((link) => link.active);
  const next = links.filter((link) => link.label === "Next »");
  const previous = links.filter((link) => link.label === "« Previous");
  if (
    lastPage < page ||
    lastPage > ALLN1_MAX_PAGES ||
    numbered.length !== lastPage ||
    numbered.some(
      (link, index) =>
        link.page !== index + 1 || link.label !== String(index + 1),
    ) ||
    current.length !== 1 ||
    current[0]?.page !== page ||
    current[0]?.label !== String(page) ||
    next.length !== (page < lastPage ? 1 : 0) ||
    (next[0] && next[0].page !== page + 1) ||
    previous.length !== (page > 1 ? 1 : 0) ||
    (previous[0] && previous[0].page !== page - 1) ||
    links.length !== numbered.length + next.length + previous.length
  )
    throw new Error(
      "All-N-1 active page, sequential continuation or terminal evidence changed",
    );
  return { lastPage, nextUrl: next[0]?.url ?? null };
}
function photo(
  cell: string,
  stock: string,
  tenant: Alln1Tenant,
): string | null {
  // Optional malformed media is null; it cannot invalidate a genuine donor.
  try {
    const images = [...cell.matchAll(/<img\b[^>]*>/gi)].filter(([tag]) =>
      hasClass(tag, "main-vehicle-img"),
    );
    const links = [...cell.matchAll(/<a\b[^>]*>/gi)];
    if (images.length !== 1 || links.length !== 1) return null;
    const src = attr(images[0]?.[0] ?? "", "src");
    const href = attr(links[0]?.[0] ?? "", "href");
    const url = src ? URL.parse(src) : null;
    if (
      !url ||
      src !== href ||
      url.protocol !== "https:" ||
      url.hostname !== "da8h1v3w8q6n5.cloudfront.net" ||
      url.username ||
      url.password ||
      url.port ||
      url.search ||
      url.hash ||
      !alln1Stock(stock)
    )
      return null;
    const match =
      /^\/([a-z0-9]+)\/images\/([A-Z0-9-]+)\/([A-Z0-9-]+)_\d+\.jpg$/i.exec(
        url.pathname,
      );
    // WI25 publishes stock-<photo number>-<native token> filenames.
    const tenantPhoto =
      tenant.source === "grandpajohns"
        ? /^\/([a-z0-9]+)\/images\/([A-Z0-9-]+)\/([A-Z0-9-]+)-\d+-[A-Z0-9]+_\d+\.jpg$/i.exec(
            url.pathname,
          )
        : match;
    return tenantPhoto &&
      tenantPhoto[1]?.toLowerCase() === tenant.yard.code.toLowerCase() &&
      tenantPhoto[2] === stock &&
      tenantPhoto[3] === stock
      ? url.href
      : null;
  } catch {
    return null;
  }
}
/**
 * Verifies the native yard scope, inventory statement and search form shared
 * by catalog pages and Set Date searches, returning the cleaned HTML. `search`
 * is the value the search field must reflect.
 */
function verifiedInventory(
  raw: string,
  tenant: Alln1Tenant,
  nonce: string | null,
  search: string,
): string {
  complete(raw);
  const uncommented = raw.replace(/<!--[\s\S]*?-->/g, "");
  const scopeScripts = [
    ...uncommented.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi),
  ].filter((match) => /\biisupullurgid\b/.test(match[2] ?? ""));
  const script = scopeScripts[0];
  const scriptTag = script?.[1] ?? "";
  const scriptBody = script?.[2] ?? "";
  const inert: string[] = [];
  // Ignore prior complete raw-text elements, then reject scope inside inert
  // HTML. A stack also catches nested templates; plaintext never closes.
  const prefix = stripInventoryRawText(
    uncommented.slice(0, script?.index ?? 0),
  );
  for (const match of prefix.matchAll(
    /<(\/?)(template|textarea|noscript|title|style|xmp|iframe|noembed|noframes|plaintext)\b[^>]*>/gi,
  )) {
    const tag = match[2]?.toLowerCase() ?? "";
    if (match[1] && tag !== "plaintext") {
      if (inert.pop() !== tag)
        throw new Error("All-N-1 scope has malformed inert HTML context");
    } else inert.push(tag);
  }
  // Native scope is in a flat block of quoted var declarations. Requiring the
  // whole block excludes comments, strings and deferred/dead-code statements.
  const declaration =
    /\bvar\s+([A-Za-z_$][\w$]*)\s*=\s*(?:'([^'\\\r\n]*)'|"([^"\\\r\n]*)")\s*;/g;
  const scopes = [...scriptBody.matchAll(declaration)].filter(
    (match) => match[1] === "iisupullurgid",
  );
  if (
    scopeScripts.length !== 1 ||
    inert.length !== 0 ||
    attr(scriptTag, "src") !== null ||
    attr(scriptTag, "nomodule") !== null ||
    ![null, "text/javascript", "application/javascript"].includes(
      attr(scriptTag, "type"),
    ) ||
    scriptBody.replace(declaration, "").trim() ||
    scopes.length !== 1 ||
    (scopes[0]?.[2] ?? scopes[0]?.[3]) !== tenant.yard.code
  )
    throw new Error(
      "All-N-1 inline native yard assignment changed or is ambiguous",
    );
  const clean = stripInventoryRawText(raw);
  const body = clean
    .replace(/<[^>]*>/g, " ")
    .replace(/&#0*39;|&apos;/gi, "'")
    .replace(/\s+/g, " ");
  if (
    !body.includes(
      "Some vehicles may not show parts available if we haven't parted them out yet.",
    )
  )
    throw new Error("All-N-1 native parts inventory statement changed");
  verifyForm(clean, nonce, search);
  return clean;
}
const ALLN1_HEADERS = [
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
/**
 * The donor rows of the one native inventory table, failing with `short`
 * unless their count is from `min` to `max`.
 */
function inventoryRecords(
  clean: string,
  tenant: Alln1Tenant,
  [min, max]: readonly [number, number],
  short: string,
): Alln1Record[] {
  const tables = [
    ...clean.matchAll(/<table\b([^>]*)>([\s\S]*?)<\/table\s*>/gi),
  ].filter((m) => hasClass(m[1] ?? "", "IISUpullTable"));
  const openings = [...clean.matchAll(/<table\b[^>]*>/gi)].filter(([tag]) =>
    hasClass(tag, "IISUpullTable"),
  );
  if (tables.length !== 1 || openings.length !== 1)
    throw new Error(
      "All-N-1 complete native inventory table is missing or ambiguous",
    );
  const table = tables[0];
  const tag = table?.[1] ?? "";
  if (
    attr(tag, "data-toggle") !== "table" ||
    attr(tag, "data-pagination") !== "true" ||
    ![null, "client"].includes(attr(tag, "data-side-pagination")) ||
    [...tag.matchAll(/\b(data-[\w-]+)(?=\s|=|>)/gi)].some(
      (m) =>
        ![
          "data-toggle",
          "data-search",
          "data-pagination",
          "data-side-pagination",
        ].includes(m[1]?.toLowerCase() ?? ""),
    )
  )
    throw new Error(
      "All-N-1 table introduced an unverified remote data source",
    );
  const { head, body: tableBody } = inventoryTableSections(table?.[2] ?? "");
  const headingRow =
    /^\s*<tr\b[^>]*>([\s\S]*?)<\/tr\s*>\s*$/i.exec(head)?.[1] ?? "";
  const headings = [...headingRow.matchAll(/<th\b[^>]*>([\s\S]*?)<\/th\s*>/gi)];
  if (
    JSON.stringify(headings.map((m) => text(m[1] ?? ""))) !==
      JSON.stringify(ALLN1_HEADERS) ||
    headingRow.replace(/<th\b[^>]*>[\s\S]*?<\/th\s*>/gi, "").trim()
  )
    throw new Error("All-N-1 native inventory headers changed");
  const rows = [...tableBody.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr\s*>/gi)];
  if (
    rows.length < min ||
    rows.length > max ||
    rows.length * 2 !== [...tableBody.matchAll(/<\/?tr\b/gi)].length ||
    tableBody.replace(/<tr\b[^>]*>[\s\S]*?<\/tr\s*>/gi, "").trim()
  )
    throw new Error(short);
  return rows.map((m): Alln1Record => {
    const row = m[1] ?? "";
    const cells = [...row.matchAll(/<(th|td)\b[^>]*>([\s\S]*?)<\/\1\s*>/gi)];
    if (
      cells.length !== 9 ||
      cells.some(
        (cell, index) =>
          cell[1]?.toLowerCase() !== (index === 0 ? "th" : "td") ||
          /<\/?(?:tr|td|th)\b/i.test(cell[2] ?? ""),
      ) ||
      [...row.matchAll(/<\/?(?:th|td)\b/gi)].length !== 18 ||
      row.replace(/<(th|td)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "").trim()
    )
      throw new Error(
        "All-N-1 donor row does not contain nine complete native cells",
      );
    const field = (index: number) => text(cells[index]?.[2] ?? "");
    const stock = field(7);
    return {
      year: field(1),
      make: field(2),
      model: field(3),
      position: field(4),
      setDate: field(5),
      vin: field(6),
      stock,
      freshSet: field(8),
      imageUrl: photo(cells[0]?.[2] ?? "", stock, tenant),
    };
  });
}
/** `nonce` is the cache-busting value the page was requested with, if any. */
export function parseAlln1Page(
  raw: string,
  page: number,
  tenant: Alln1Tenant = ALLN1_TENANT,
  nonce: string | null = null,
) {
  if (!Number.isSafeInteger(page) || page < 1 || page > ALLN1_MAX_PAGES)
    throw new Error(
      "All-N-1 requested page is outside its bounded native traversal",
    );
  const clean = verifiedInventory(raw, tenant, nonce, "");
  const paging = pagination(clean, page, tenant, nonce);
  const records = inventoryRecords(
    clean,
    tenant,
    [page < paging.lastPage ? ALLN1_PAGE_SIZE : 1, ALLN1_PAGE_SIZE],
    "All-N-1 page is empty, incomplete or short before terminal pagination",
  );
  return {
    records,
    page,
    ...paging,
    scopeHash: alln1Hash({
      yard: tenant.yard.code,
      headers: ALLN1_HEADERS,
      lastPage: paging.lastPage,
      form: {
        action: "/inventory/ANY/ANY/",
        method: "get",
        k: "1",
        view: "table",
        search: "",
      },
    }),
    hash: alln1Hash({ records, page, ...paging }),
  };
}
export type Alln1Page = ReturnType<typeof parseAlln1Page>;

export interface Alln1Search {
  date: string;
  records: Alln1Record[];
}
/**
 * The native search for one Set Date, requested with `nonce`. It must pass the
 * same scope, statement, form and table checks as a catalog page, reflect the
 * searched date, publish no pagination and hold only donors set on that date.
 * A full 500-row page could hide further matches, so it fails closed.
 */
export function parseAlln1Search(
  raw: string,
  date: string,
  tenant: Alln1Tenant = ALLN1_TENANT,
  nonce: string | null = null,
): Alln1Search {
  if (alln1SourceDate(date) !== date)
    throw new Error("All-N-1 Set Date search date " + date + " is invalid");
  const clean = verifiedInventory(raw, tenant, nonce, date);
  const navs = [...clean.matchAll(/<nav\b([^>]*)>/gi)].filter((m) =>
    hasClass(m[1] ?? "", "iis-upull-pagination-wrapper"),
  );
  if (navs.length || /[?&](?:amp;|#0*38;)?pagenum=/i.test(clean))
    throw new Error(
      "All-N-1 Set Date search for " +
        date +
        " publishes pagination, so it may not list every donor of that date",
    );
  const records = inventoryRecords(
    clean,
    tenant,
    [1, ALLN1_PAGE_SIZE - 1],
    "All-N-1 Set Date search for " +
      date +
      " is empty, malformed or holds " +
      ALLN1_PAGE_SIZE +
      " or more rows; completeness is only known for 1 to " +
      (ALLN1_PAGE_SIZE - 1) +
      " donors",
  );
  if (records.some((record) => record.setDate !== date))
    throw new Error(
      "All-N-1 Set Date search for " +
        date +
        " returned donors set on another date",
    );
  return { date, records };
}
