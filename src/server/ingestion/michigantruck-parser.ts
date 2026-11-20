import { createHash } from "node:crypto";
import {
  michigantruckAttribute as attr,
  michigantruckText as text,
  michigantruckDivs as divs,
  michigantruckHasClass as hasClass,
  michigantruckDocument,
} from "./michigantruck-html";
import {
  MichigantruckRecordSchema,
  michigantruckDetailUrl,
  michigantruckPhotoUrl,
  type MichigantruckRecord,
} from "./michigantruck-record";
import {
  MICHIGANTRUCK_CATALOG,
  MICHIGANTRUCK_ORIGIN,
  MICHIGANTRUCK_SALVAGE,
} from "./michigantruck-yard-metadata";

export const MICHIGANTRUCK_PAGE_SIZE = 25;
/** Our census bound, not the site's: the catalog pages on with
 * `page_number` and ignores `per_page`. It listed 195 rows (8 pages) in
 * Nov 2026; 16 pages (400 rows) leaves room to grow. */
export const MICHIGANTRUCK_MAX_PAGES = 16;
/** Contact, every retained or new page, the terminal reread of every page,
 * then the Salvage detail and selector controls. */
export const MICHIGANTRUCK_MAX_CHUNK_REQUESTS = 2 * MICHIGANTRUCK_MAX_PAGES + 3;
export interface MichigantruckPage {
  page: number;
  total: number;
  salvageTotal: number;
  retailTotal: number;
  nextUrl: string | null;
  records: MichigantruckRecord[];
  hash: string;
}

export function michigantruckPageUrl(raw: string, page: number): boolean {
  const url = URL.parse(raw);
  return (
    !!url &&
    url.origin === MICHIGANTRUCK_ORIGIN &&
    url.pathname === "/trucks/" &&
    !url.username &&
    !url.password &&
    !url.hash &&
    url.href === raw &&
    (page === 1
      ? raw === MICHIGANTRUCK_CATALOG
      : [...url.searchParams].length === 1 &&
        url.searchParams.get("page_number") === String(page))
  );
}
function optionalText(raw: string): string | null {
  try {
    const value = text(raw);
    return value.length <= 500 ? value : null;
  } catch {
    return null;
  }
}
function record(card: string): MichigantruckRecord {
  const links = [...card.matchAll(/<a\b[^>]*>/gi)].map(([tag]) =>
    attr(tag, "href"),
  );
  const detailsUrl = links[0];
  if (
    links.length !== 3 ||
    !detailsUrl ||
    links.some((link) => link !== detailsUrl) ||
    michigantruckDetailUrl(detailsUrl) === null
  )
    throw new Error(
      "Michigan Truck card must publish three identical native detail destinations",
    );
  const id = /-([1-9]\d{0,11})$/.exec(detailsUrl)?.[1];
  const fields = new Map<string, string | null>();
  const optional = new Set(["Lot Number", "Engine Model"]);
  const supported = new Set([
    "Truck Make",
    "Truck Model",
    "Vin Number",
    "Lot Number",
    "Condition",
    "Engine Model",
  ]);
  for (const pair of card.matchAll(
    /<div\b[^>]*>\s*<h6\b[^>]*>((?:(?!<\/h6\b)[\s\S])*)<\/h6>\s*<\/div>\s*<div\b[^>]*>\s*<p\b[^>]*>((?:(?!<\/p\b)[\s\S])*)<\/p>\s*<\/div>/gi,
  )) {
    const label = text(pair[1] ?? "").replace(/\s*:\s*$/, "");
    if (!supported.has(label)) continue;
    if (fields.has(label))
      throw new Error("Michigan Truck repeats native field " + label);
    fields.set(
      label,
      optional.has(label) ? optionalText(pair[2] ?? "") : text(pair[2] ?? ""),
    );
  }
  const condition = fields.get("Condition");
  if (condition !== "Salvage" && condition !== "Complete")
    throw new Error("Unknown Michigan Truck native condition");
  const headings = [...card.matchAll(/<h2\b[^>]*>([\s\S]*?)<\/h2>/gi)];
  const title = headings.length === 1 ? text(headings[0]?.[1] ?? "") : "";
  const heading = /^(Salvage|Used) (\d{4})\s/.exec(title);
  if (!heading || heading[1] !== (condition === "Salvage" ? "Salvage" : "Used"))
    throw new Error("Michigan Truck heading and native condition disagree");
  const images = [...card.matchAll(/<img\b[^>]*>/gi)];
  let imageUrl: string | null = null;
  if (images.length === 1) {
    const tag = images[0]?.[0] ?? "";
    const enclosed = [...card.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a\s*>/gi)].some(
      (match) => (match[1] ?? "").includes(tag),
    );
    if (enclosed) {
      try {
        imageUrl = michigantruckPhotoUrl(attr(tag, "data-src"));
      } catch {
        imageUrl = null;
      }
    }
  }
  return MichigantruckRecordSchema.parse({
    id,
    year: heading[2],
    make: fields.get("Truck Make") ?? "",
    model: fields.get("Truck Model") ?? "",
    vin: fields.get("Vin Number") ?? "",
    stockNumber: fields.get("Lot Number") || null,
    imageUrl,
    detailsUrl,
    condition,
    engine: fields.get("Engine Model") || null,
  });
}

export function parseMichigantruckPage(
  raw: string,
  requestedPage: number,
  selected = false,
): MichigantruckPage {
  if (
    !Number.isSafeInteger(requestedPage) ||
    requestedPage < 1 ||
    requestedPage > MICHIGANTRUCK_MAX_PAGES ||
    (selected && requestedPage !== 1)
  )
    throw new Error(
      "Michigan Truck page is outside the verified traversal budget",
    );
  const html = michigantruckDocument(raw);
  const titles = divs(html, "filter-title").filter(
    (block) => text(block) === "Current Filters",
  );
  const current = divs(html, "current-filter-list");
  if (
    selected
      ? titles.length !== 1 ||
        current.length !== 1 ||
        text((current[0] ?? "").replace(/<a\b[^>]*>[\s\S]*?<\/a>/gi, "")) !==
          "Condition: Salvage"
      : titles.length !== 0 || current.length !== 0
  )
    throw new Error(
      "Michigan Truck active filters narrowed or changed the native traversal",
    );
  const conditions = divs(html, "filter-list").filter(
    (block) =>
      attr(block.slice(0, block.indexOf(">") + 1), "id") === "conditionFilter",
  );
  const options = divs(conditions[0] ?? "", "filter-option").map((block) =>
    text(block),
  );
  const salvage = /^Salvage (\d+)$/.exec(options[0] ?? "");
  const retail = /^Complete (\d+)$/.exec(options[1] ?? "");
  if (
    conditions.length !== 1 ||
    !salvage ||
    (selected ? options.length !== 1 : options.length !== 2 || !retail)
  )
    throw new Error("Michigan Truck native condition facets changed");
  const salvageTotal = Number(salvage[1]),
    retailTotal = selected ? 0 : Number(retail?.[1]);
  const pagers = [...html.matchAll(/(<ul\b[^>]*>)([\s\S]*?)<\/ul>/gi)].filter(
    (m) => hasClass(m[1] ?? "", "pagination"),
  );
  if (pagers.length !== 2)
    throw new Error("Michigan Truck header/footer pagination missing");
  let total = 0;
  let nextUrl: string | null = null;
  for (const pager of pagers) {
    const inner = pager[2] ?? "";
    const ranges = [
      ...inner.matchAll(/(<span\b[^>]*>)([\s\S]*?)<\/span>/gi),
    ].filter((m) => hasClass(m[1] ?? "", "pagination-info"));
    const range = /^(\d+)-(\d+) of (\d+)$/.exec(text(ranges[0]?.[2] ?? ""));
    const active = [
      ...inner.matchAll(/(<li\b[^>]*>)([\s\S]*?)<\/li>/gi),
    ].filter((m) => hasClass(m[1] ?? "", "active"));
    if (
      ranges.length !== 1 ||
      !range ||
      active.length !== 1 ||
      text(active[0]?.[2] ?? "") !== String(requestedPage)
    )
      throw new Error("Michigan Truck range or selected page changed");
    const declared = Number(range[3]),
      lastPage = Math.ceil(declared / 25);
    if (
      declared < 1 ||
      declared > MICHIGANTRUCK_MAX_PAGES * MICHIGANTRUCK_PAGE_SIZE ||
      (total !== 0 && declared !== total) ||
      Number(range[1]) !== (requestedPage - 1) * 25 + 1 ||
      Number(range[2]) !== Math.min(requestedPage * 25, declared) ||
      requestedPage > lastPage
    )
      throw new Error(
        "Michigan Truck native page census changed or exceeded its budget",
      );
    total = declared;
    const next: string[] = [];
    const last: string[] = [];
    for (const anchor of inner.matchAll(/(<a\b[^>]*>)([\s\S]*?)<\/a>/gi)) {
      const label = text(anchor[2] ?? "");
      if (label !== "Next Page" && label !== "Last Page") continue;
      const href = attr(anchor[1] ?? "", "href");
      const number = label === "Next Page" ? requestedPage + 1 : lastPage;
      const valid = selected
        ? href === MICHIGANTRUCK_SALVAGE + "&page_number=" + number
        : href !== null && michigantruckPageUrl(href, number);
      if (!valid || href === null)
        throw new Error(
          "Michigan Truck pagination left its actual published scope",
        );
      (label === "Next Page" ? next : last).push(href);
    }
    const forward = requestedPage < lastPage ? 1 : 0;
    if (
      next.length !== forward ||
      last.length !== forward ||
      (nextUrl !== null && nextUrl !== next[0])
    )
      throw new Error(
        "Michigan Truck missing, duplicate or terminal forward link",
      );
    nextUrl = next[0] ?? null;
  }
  if (
    salvageTotal < 1 ||
    !Number.isSafeInteger(retailTotal) ||
    retailTotal < 0 ||
    salvageTotal + retailTotal !== total
  )
    throw new Error(
      "Michigan Truck condition facets do not reconcile with its native census",
    );
  const records = divs(html, "list-item").map(record);
  if (
    records.length !== Math.min(25, total - (requestedPage - 1) * 25) ||
    new Set(records.map((row) => row.id)).size !== records.length ||
    (selected && records.some((row) => row.condition !== "Salvage"))
  )
    throw new Error(
      "Michigan Truck card identities/counts contradict its census",
    );
  const page = {
    page: requestedPage,
    total,
    salvageTotal,
    retailTotal,
    nextUrl,
    records,
  };
  return {
    ...page,
    hash: createHash("sha256").update(JSON.stringify(page)).digest("hex"),
  };
}
