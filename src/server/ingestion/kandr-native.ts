import { createHash } from "node:crypto";
import {
  inventoryHtmlAttribute,
  stripInventoryRawText,
} from "./inventory-html";

export const KANDR_ORIGIN = "https://kandrtruckparts.com";
export const KANDR_CONTROLS = KANDR_ORIGIN + "/used-truck-parts-search/";
export const KANDR_MAX_BODY_BYTES = 2 * 1024 * 1024;
export type KandrCategory = "99994" | "99992";
const categories = {
  "99994": "Vehicles For Parts",
  "99992": "Dismantled Vehicles",
} as const;
const defaults = {
  keywords: "",
  manufacturer: "",
  model: "",
  category: "",
  year_start: "0",
  year_end: "0",
  sortby: "price",
  sortorder: "DESC",
  zip: "",
  distance: "",
  result_size: "25",
} as const;
export interface KandrCard {
  id: string;
  url: string;
  titles: string[];
  fields: Record<string, string[]>;
}
export interface KandrListing {
  url: string;
  category: KandrCategory;
  page: number;
  total: number;
  lastPage: number;
  nextUrl: string | null;
  cards: KandrCard[];
  fingerprint: string;
}
export interface KandrDetail {
  id: string;
  url: string;
  category: KandrCategory;
  title: string;
  fields: Record<string, string[]>;
  descriptions: string[];
  images: string[];
}
export const kandrHash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const named: Readonly<Record<string, string>> = {
  amp: "&",
  quot: '"',
  apos: "'",
  nbsp: " ",
  lt: "<",
  gt: ">",
  ndash: "–",
  mdash: "\u2014",
  copy: "©",
  raquo: "»",
  laquo: "«",
};
const text = (raw: string): string =>
  raw
    .replace(/<[^>]*>/g, " ")
    .replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (entity: string, key: string) => {
      if (!key.startsWith("#")) {
        const decoded = named[key.toLowerCase()];
        if (decoded === undefined)
          throw new Error("Unknown K&R entity " + entity);
        return decoded;
      }
      const hex = /^#x/i.test(key),
        point = Number.parseInt(key.slice(hex ? 2 : 1), hex ? 16 : 10);
      if (
        point <= 0 ||
        point > 0x10ffff ||
        (point >= 0xd800 && point <= 0xdfff)
      )
        throw new Error("Invalid K&R entity");
      return String.fromCodePoint(point);
    })
    .replace(/\s+/g, " ")
    .trim();
const attr = (tag: string, name: string) => {
  const value = inventoryHtmlAttribute(tag, name);
  return value === null ? null : text(value);
};
const hasClass = (tag: string, name: string) =>
  (attr(tag, "class") ?? "").split(/\s+/).includes(name);
/** Balanced source regions reject truncation and nested copies of their own boundary. */
function blocks(
  html: string,
  element: string,
  matches: (tag: string) => boolean,
): string[] {
  const found: string[] = [];
  let start: number | null = null,
    depth = 0;
  for (const match of html.matchAll(
    new RegExp(`<\\/?${element}\\b[^>]*>`, "gi"),
  )) {
    const closing = /^<\//.test(match[0]);
    if (start === null) {
      if (!closing && matches(match[0])) {
        start = match.index;
        depth = 1;
      }
    } else if (closing) {
      if (--depth === 0) {
        found.push(html.slice(start, match.index + match[0].length));
        start = null;
      }
    } else {
      if (matches(match[0]))
        throw new Error("Nested K&R " + element + " boundary");
      depth++;
    }
  }
  if (start !== null) throw new Error("Unclosed K&R " + element);
  return found;
}
function one(values: string[], label: string): string {
  const value = values[0];
  if (values.length !== 1 || value === undefined)
    throw new Error("Missing or repeated K&R " + label);
  return value;
}
function document(raw: string): string {
  if (
    Buffer.byteLength(raw) > KANDR_MAX_BODY_BYTES ||
    !/<\/html\s*>\s*$/i.test(raw)
  )
    throw new Error("K&R document is oversized or truncated");
  const clean = stripInventoryRawText(raw);
  if (!/<title\b[^>]*>[^<]*K&amp;R[^<]*<\/title>/i.test(clean))
    throw new Error("K&R operator title changed");
  return clean;
}
function owned(raw: string): URL {
  const url = URL.parse(raw, KANDR_ORIGIN);
  if (
    !url ||
    url.origin !== KANDR_ORIGIN ||
    url.username ||
    url.password ||
    url.hash
  )
    throw new Error("Foreign K&R destination");
  return url;
}
function destination(
  raw: string,
  detail: boolean,
): {
  url: string;
  category: KandrCategory;
  page: number;
  id: string | null;
} {
  const url = owned(raw),
    query = url.searchParams;
  const keys = [...query.keys()];
  // Native page-two Previous/1 links omit page_number, the published first-page default.
  const pageRaw = query.get("page_number") ?? "1";
  const allowed = [
    ...(query.has("page_number") ? ["page_number"] : []),
    "part_type",
    ...Object.keys(defaults),
    ...(detail ? ["more"] : []),
  ];
  const category = query.get("part_type"),
    page = Number(pageRaw);
  if (
    url.pathname !== "/results-page/" ||
    keys.length !== allowed.length ||
    new Set(keys).size !== keys.length ||
    keys.some((k) => !allowed.includes(k)) ||
    !/^[1-9]\d{0,2}$/.test(pageRaw) ||
    page > 400 ||
    (category !== "99992" && category !== "99994") ||
    Object.entries(defaults).some(([k, v]) => query.get(k) !== v)
  )
    throw new Error(
      "K&R destination has active filters, unknown keys or invalid donor category/page",
    );
  const id = detail ? query.get("more") : null;
  if (detail && !/^6483483\/1\/[1-9]\d{0,11}$/.test(id ?? ""))
    throw new Error("K&R donor left its native supplier/yard boundary");
  return { url: url.href, category, page, id };
}
function fields(html: string, detail: boolean): Record<string, string[]> {
  const found: Record<string, string[]> = {};
  const pattern = detail
    ? /<div\b[^>]*>\s*<strong\b[^>]*>([^<]*)<\/strong>([^<]*)<\/div>/gi
    : /<div\b[^>]*>\s*<span\b[^>]*class=["']label["'][^>]*>([^<]*)<\/span>\s*<span\b[^>]*class=["']value["'][^>]*>([^<]*)<\/span>\s*<\/div>/gi;
  for (const match of html.matchAll(pattern)) {
    const label = text(match[1] ?? "").replace(/:\s*$/, "");
    (found[label] ??= []).push(text(match[2] ?? ""));
  }
  const observed = detail
    ? [...html.matchAll(/<strong\b/gi)].length
    : [...html.matchAll(/<span\b[^>]*class=["']label["']/gi)].length;
  if (
    Object.values(found).reduce((n, values) => n + values.length, 0) !==
    observed
  )
    throw new Error("K&R labeled fields are incomplete or ambiguous");
  return found;
}
function owner(html: string) {
  const plain = text(html);
  if (
    !plain.includes("840 Interchange Drive") ||
    !plain.includes("Holland, MI 49423") ||
    !plain.includes("616-392-8377")
  )
    throw new Error("K&R donor ownership/geography changed");
}
function controls(raw: string): string[] {
  const html = document(raw),
    form = one(
      blocks(html, "form", (tag) => hasClass(tag, "heavysearch-form")),
      "search form",
    );
  const opening = /^<form\b[^>]*>/i.exec(form)?.[0] ?? "";
  if (
    attr(opening, "method") !== "get" ||
    attr(opening, "action") !== "/results-page/"
  )
    throw new Error("K&R native search form changed");
  const partTypes = one(
    blocks(form, "select", (tag) => attr(tag, "name") === "part_type"),
    "part type selector",
  );
  const options = [
    ...partTypes.matchAll(/(<option\b[^>]*>)([\s\S]*?)<\/option>/gi),
  ].map((m) => ({ value: attr(m[1] ?? "", "value"), label: text(m[2] ?? "") }));
  for (const [value, label] of Object.entries(categories)) {
    if (
      options.filter((o) => o.value === value && o.label === label).length !== 1
    )
      throw new Error("K&R published donor categories changed");
  }
  if (
    options.some(
      (o) =>
        /^(?:Dismantled Vehicles|Vehicles For )/i.test(o.label) &&
        !["99992", "99994", "99993"].includes(o.value ?? ""),
    )
  )
    throw new Error("K&R gained an unclassified vehicle category");
  const inputs = [...form.matchAll(/<(?:input|select)\b[^>]*>/gi)].map(
    ([tag]) => ({ tag, name: attr(tag, "name") }),
  );
  const expected = ["page_number", "part_type", ...Object.keys(defaults)];
  if (
    inputs.length !== expected.length ||
    expected.some((name) => inputs.filter((i) => i.name === name).length !== 1)
  )
    throw new Error("K&R native form fields changed");
  for (const [name, value] of Object.entries({
    page_number: "1",
    ...defaults,
  })) {
    const input = inputs.find((i) => i.name === name);
    if (!input) throw new Error("Missing K&R form field " + name);
    let selected: string | null;
    if (/^<input\b/i.test(input.tag)) selected = attr(input.tag, "value");
    else {
      const select = one(
        blocks(form, "select", (tag) => attr(tag, "name") === name),
        name + " selector",
      );
      const choices = [...select.matchAll(/<option\b[^>]*>/gi)].map(
        (m) => m[0],
      );
      const marked = choices.filter((tag) => attr(tag, "selected") !== null);
      if (marked.length > 1)
        throw new Error("K&R form has multiple selected defaults");
      selected = attr(marked[0] ?? choices[0] ?? "", "value");
    }
    if (selected !== value)
      throw new Error("K&R native form default changed: " + name);
  }
  return (["99994", "99992"] as const).map((category) => {
    const query = new URLSearchParams({
      page_number: "1",
      keywords: defaults.keywords,
      part_type: category,
      ...Object.fromEntries(
        Object.entries(defaults).filter(([key]) => key !== "keywords"),
      ),
    });
    return KANDR_ORIGIN + "/results-page/?" + query.toString();
  });
}
function listing(raw: string, sourceUrl: string): KandrListing {
  const source = destination(sourceUrl, false),
    html = document(raw);
  const region = one(
    blocks(html, "section", (tag) => hasClass(tag, "heavysearch-results")),
    "inventory region",
  );
  const heading = one(
    blocks(region, "h1", (tag) => hasClass(tag, "heavysearch-results-heading")),
    "category heading",
  );
  if (text(heading) !== categories[source.category])
    throw new Error("K&R donor scope changed");
  const summary = one(
    blocks(region, "p", (tag) => hasClass(tag, "heavysearch-results-summary")),
    "count summary",
  );
  const count =
    /^Your search has (\d+) matches\. Now showing results (\d+) through (\d+)\.$/.exec(
      text(summary),
    );
  const total = Number(count?.[1]),
    lastPage = Math.ceil(total / 25);
  if (
    !count ||
    total < 1 ||
    total > 10000 ||
    source.page > lastPage ||
    Number(count[2]) !== (source.page - 1) * 25 + 1 ||
    Number(count[3]) !== Math.min(total, source.page * 25)
  )
    throw new Error("K&R native counts or page ranges do not reconcile");
  const table = one(
    blocks(region, "table", (tag) =>
      hasClass(tag, "heavysearch-results-table"),
    ),
    "donor table",
  );
  const rows = blocks(table, "tr", () => true);
  if (
    rows.length !== Math.min(25, total - (source.page - 1) * 25) * 3 ||
    [...table.matchAll(/<tr\b/gi)].length !== rows.length
  )
    throw new Error("K&R donor row groups are incomplete");
  const cards: KandrCard[] = [];
  for (let index = 0; index < rows.length; index += 3) {
    const header = rows[index] ?? "",
      top = rows[index + 1] ?? "",
      bottom = rows[index + 2] ?? "";
    if (
      !hasClass(/^<tr\b[^>]*>/i.exec(header)?.[0] ?? "", "header") ||
      !hasClass(/^<tr\b[^>]*>/i.exec(top)?.[0] ?? "", "bodyTop") ||
      !hasClass(/^<tr\b[^>]*>/i.exec(bottom)?.[0] ?? "", "bodyBottom")
    )
      throw new Error("K&R row grouping changed");
    const group = header + top + bottom;
    const links = [...group.matchAll(/<a\b[^>]*>/gi)].flatMap(([tag]) => {
      const literal = attr(tag, "href");
      if (literal === null || !literal.includes("more=")) return [];
      const url = destination(literal, true);
      if (url.category !== source.category || url.page !== source.page)
        throw new Error("K&R donor link changed its parent category/page");
      return [url];
    });
    const link = links[0];
    if (
      !link?.id ||
      links.length < 3 ||
      links.some((l) => l.id !== link.id || l.url !== link.url) ||
      decodeURIComponent(
        attr(/^<tr\b[^>]*>/i.exec(header)?.[0] ?? "", "id") ?? "",
      ) !== link.id
    )
      throw new Error("K&R native donor destinations conflict or disappear");
    owner(top);
    const titles = [...group.matchAll(/<h2\b[^>]*>([\s\S]*?)<\/h2>/gi)].map(
      (m) => text(m[1] ?? ""),
    );
    if (titles.length !== 2)
      throw new Error("K&R donor titles are structurally incomplete");
    cards.push({
      id: link.id,
      url: link.url,
      titles,
      fields: fields(top, false),
    });
  }
  if (new Set(cards.map((c) => c.id)).size !== cards.length)
    throw new Error("K&R page repeats a traversal identifier");
  const pagers = blocks(region, "p", (tag) =>
    hasClass(tag, "heavysearch-results-pagination"),
  );
  if (pagers.length !== 2)
    throw new Error("K&R header/footer pagination is incomplete");
  let nextUrl: string | null = null;
  for (const pager of pagers) {
    const links = [...pager.matchAll(/(<a\b[^>]*>)([\s\S]*?)<\/a>/gi)].map(
      (m) => ({
        url: destination(attr(m[1] ?? "", "href") ?? "", false),
        label: text(m[2] ?? ""),
      }),
    );
    if (
      links.some(
        (l) => l.url.category !== source.category || l.url.page > lastPage,
      )
    )
      throw new Error("K&R pagination leaves its category");
    const next = links.filter((l) => l.label === "Next »");
    if (
      source.page < lastPage
        ? next.length !== 1 || next[0]?.url.page !== source.page + 1
        : next.length !== 0
    )
      throw new Error("K&R terminal or next-page evidence changed");
    const currentNext = next[0]?.url.url ?? null;
    if (nextUrl !== null && nextUrl !== currentNext)
      throw new Error("K&R pagination controls disagree");
    nextUrl = currentNext;
  }
  const page = {
    url: source.url,
    category: source.category,
    page: source.page,
    total,
    lastPage,
    nextUrl,
    cards,
  };
  return { ...page, fingerprint: kandrHash(page) };
}
function detail(raw: string, sourceUrl: string): KandrDetail {
  const source = destination(sourceUrl, true),
    html = document(raw);
  const region = one(
    blocks(html, "div", (tag) =>
      hasClass(tag, "heavysearch-results-moredetails-cnt"),
    ),
    "donor detail",
  );
  const title = text(
    one(
      blocks(html, "h1", (tag) => hasClass(tag, "heavysearch-results-heading")),
      "detail heading",
    ),
  );
  if (!title.endsWith(" " + categories[source.category]) || !source.id)
    throw new Error("K&R detail lost its donor scope");
  owner(region);
  const descriptions = [...region.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)]
    .map((m) => text(m[1] ?? ""))
    .filter(Boolean);
  const images = [
    ...new Set(
      [...region.matchAll(/<a\b[^>]*>/gi)].flatMap(([tag]) => {
        const literal = attr(tag, "href"),
          image = literal === null ? null : URL.parse(literal);
        const suffix = source.id?.replaceAll("/", "_");
        return image?.origin === "https://imagehost.heavytruckparts.net" &&
          !image.search &&
          !image.hash &&
          !image.username &&
          !image.password &&
          new RegExp(`_${suffix}_\\d+\\.jpg$`).test(image.pathname)
          ? [image.href]
          : [];
      }),
    ),
  ];
  return {
    id: source.id,
    url: source.url,
    category: source.category,
    title,
    fields: fields(region, true),
    descriptions,
    images,
  };
}

export const KandrNative = {
  controls,
  listing,
  detail,
  destination,
  text,
  categories,
} as const;
