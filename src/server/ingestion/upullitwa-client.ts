import { createHash } from "node:crypto";
import { Data, Effect } from "effect";
import { hasHttpPaginationLink } from "./provider-http-pagination";
import {
  stripInventoryRawText,
  inventoryHtmlAttribute,
  inventoryTableSections,
} from "./inventory-html";
import {
  fetchProviderText,
  type ProviderRequestGate,
} from "./provider-http-client";
import {
  UPULLITWA_MAX_PAGES_PER_YARD,
  UpullitwaYardIdSchema,
} from "./upullitwa-cursor";

export const UPULLITWA_ORIGIN = "https://go2upullit.com";
const INVENTORY_PATH = "/inventory/ANY/ANY/";
const MAX_ROWS = 1_000;

export class UpullitwaProviderError extends Data.TaggedError(
  "UpullitwaProviderError",
)<{
  operation: string;
  cause: unknown;
}> {
  override get message() {
    return `Washington U-Pull-It ${this.operation}: ${this.cause instanceof Error ? this.cause.message : String(this.cause)}`;
  }
}

export interface UpullitwaRecord {
  year: string;
  make: string;
  model: string;
  row: string;
  date: string;
  vin: string;
  stockNumber: string;
  imageUrl: string | null;
}

export interface UpullitwaPage {
  records: UpullitwaRecord[];
  yardIds: string[];
  nextUrl: string | null;
  lastPage: number;
  fingerprint: string;
}

export function upullitwaPageUrl(yardId: string, page: number): string {
  return `${UPULLITWA_ORIGIN}${INVENTORY_PATH}?k=1&id=${yardId}&view=table&pagenum=${page}`;
}

// Only this provider's small, flat table grammar is supported. Fail closed when
// its structure changes rather than treating an arbitrary WordPress page as empty.
function decode(value: string): string {
  const named: Record<string, string> = {
    amp: "&",
    quot: '"',
    apos: "'",
    lt: "<",
    gt: ">",
    nbsp: " ",
    raquo: "»",
    laquo: "«",
  };
  return value.replace(
    /&(#x[\da-f]+|#\d+|[a-z]+);/gi,
    (entity: string, key: string) => {
      if (key.startsWith("#")) {
        const point =
          key[1]?.toLowerCase() === "x"
            ? Number.parseInt(key.slice(2), 16)
            : Number(key.slice(1));
        if (
          point <= 0 ||
          point > 0x10ffff ||
          (point >= 0xd800 && point <= 0xdfff)
        )
          throw new Error("Invalid HTML character reference");
        return String.fromCodePoint(point);
      }
      const decoded = named[key.toLowerCase()];
      if (decoded === undefined)
        throw new Error(
          `Unsupported HTML entity ${entity}; inspect the inventory table`,
        );
      return decoded;
    },
  );
}

function text(html: string): string {
  return decode(html.replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function attribute(tag: string, name: string): string | null {
  const value = inventoryHtmlAttribute(tag, name);
  return value === null ? null : decode(value);
}

function hasClass(tag: string, name: string): boolean {
  return (attribute(tag, "class") ?? "").split(/\s+/).includes(name);
}

function checkUrl(raw: string, yardId: string): URL {
  const url = new URL(raw, UPULLITWA_ORIGIN);
  const params = url.searchParams;
  if (
    url.origin !== UPULLITWA_ORIGIN ||
    url.pathname !== INVENTORY_PATH ||
    url.username ||
    url.password ||
    url.hash ||
    params.get("id") !== yardId ||
    params.get("k") !== "1" ||
    params.get("view") !== "table" ||
    [...params.keys()].some(
      (key) => !["id", "k", "view", "pagenum"].includes(key),
    ) ||
    [...params.keys()].some((key) => params.getAll(key).length !== 1) ||
    !/^[1-9]\d*$/.test(params.get("pagenum") ?? "") ||
    Number(params.get("pagenum")) > UPULLITWA_MAX_PAGES_PER_YARD
  )
    throw new Error(
      `Unsafe or out-of-bounds inventory pagination for yard ${yardId}; inspect the provider links`,
    );
  return url;
}

export function parseUpullitwaPage(
  rawHtml: string,
  yardId: string,
  page: number,
): UpullitwaPage {
  checkUrl(upullitwaPageUrl(yardId, page), yardId);
  if (yardId !== "ANY" && !UpullitwaYardIdSchema.safeParse(yardId).success)
    throw new Error("Invalid inventory yard ID");
  const html = stripInventoryRawText(rawHtml);
  const selectors = [
    ...html.matchAll(/<select\b([^>]*)>([\s\S]*?)<\/select>/gi),
  ].filter((match) => hasClass(match[1] ?? "", "upullsimpleLocation"));
  if (selectors.length !== 1)
    throw new Error("Missing or ambiguous inventory yard selector");
  const options = [
    ...(selectors[0]?.[2] ?? "").matchAll(
      /<option\b([^>]*)>([\s\S]*?)<\/option>/gi,
    ),
  ];
  const yardIds: string[] = [];
  const selected: string[] = [];
  for (const option of options) {
    const attrs = option[1] ?? "";
    const id = attribute(attrs, "value");
    if (!id) continue;
    if (attribute(attrs, "selected") !== null) selected.push(id);
    if (id === "ANY") continue;
    if (!UpullitwaYardIdSchema.safeParse(id).success || yardIds.includes(id))
      throw new Error("Invalid or duplicate inventory yard ID");
    yardIds.push(id);
  }
  if (
    yardIds.length === 0 ||
    yardIds.length > 32 ||
    (yardId !== "ANY" && (selected.length !== 1 || selected[0] !== yardId))
  ) {
    throw new Error(
      `Inventory yard selector did not confirm ${yardId}; the filter may have been ignored`,
    );
  }

  const tables = [
    ...html.matchAll(/<table\b([^>]*)>([\s\S]*?)<\/table>/gi),
  ].filter((match) => hasClass(match[1] ?? "", "IISUpullTable"));
  if (tables.length !== 1)
    throw new Error("Missing or ambiguous IISUpullTable inventory table");
  const table = tables[0]?.[2] ?? "";
  const { head, body } = inventoryTableSections(table);
  const headers = [...head.matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/gi)].map(
    (match) => text(match[1] ?? "").toLowerCase(),
  );
  const expected = [
    "image",
    "year",
    "make",
    "model",
    "row",
    "date",
    "vin",
    "stock #",
    "fresh set",
  ];
  if (JSON.stringify(headers) !== JSON.stringify(expected))
    throw new Error(
      "Inventory table columns changed; inspect the VIN column before resuming",
    );
  const rows = [...body.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)];
  if (
    rows.length === 0 ||
    rows.length > MAX_ROWS ||
    rows.length * 2 !== [...body.matchAll(/<\/?tr\b/gi)].length ||
    /<\/?(?:td|th)\b/i.test(body.replace(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi, ""))
  )
    throw new Error(
      "Inventory table is empty, truncated, or exceeds the row cap",
    );
  const records = rows.map((row): UpullitwaRecord => {
    const rowHtml = row[1] ?? "";
    const cells = [
      ...rowHtml.matchAll(/<(td|th)\b[^>]*>([\s\S]*?)<\/\1>/gi),
    ].map((match) => match[2] ?? "");
    if (
      cells.length !== headers.length ||
      [...rowHtml.matchAll(/<\/?(td|th)\b/gi)].length !== cells.length * 2 ||
      /\b(?:colspan|rowspan)\s*=/i.test(rowHtml)
    )
      throw new Error("Inventory row has missing or extra columns");
    const [image, year, make, model, rowText, date, vin, stockNumber] = cells;
    if (
      [image, year, make, model, rowText, date, vin, stockNumber].some(
        (value) => value === undefined,
      )
    )
      throw new Error("Inventory row is truncated");
    return {
      year: text(year ?? ""),
      make: text(make ?? ""),
      model: text(model ?? ""),
      row: text(rowText ?? ""),
      date: text(date ?? ""),
      vin: text(vin ?? ""),
      stockNumber: text(stockNumber ?? ""),
      imageUrl: attribute(/<img\b[^>]*>/i.exec(image ?? "")?.[0] ?? "", "src"),
    };
  });

  const navs = [...html.matchAll(/<nav\b([^>]*)>([\s\S]*?)<\/nav>/gi)].filter(
    (match) => hasClass(match[1] ?? "", "iis-upull-pagination-wrapper"),
  );
  if (navs.length === 0)
    throw new Error(
      "Inventory pagination is missing; completeness cannot be verified",
    );
  let nextUrl: string | null = null;
  let lastPage = 0;
  let previousSignature: string | null = null;
  for (const nav of navs) {
    const contents = nav[2] ?? "";
    const links = [...contents.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)].map(
      (match) => {
        const href = attribute(match[1] ?? "", "href");
        if (!href) throw new Error("Inventory pagination link lacks href");
        return { url: checkUrl(href, yardId), label: text(match[2] ?? "") };
      },
    );
    const active = [
      ...contents.matchAll(/<li\b([^>]*)>\s*<a\b([^>]*)>/gi),
    ].filter((match) => hasClass(match[1] ?? "", "active"));
    const activeHref =
      active.length === 1 ? attribute(active[0]?.[2] ?? "", "href") : null;
    if (
      !activeHref ||
      Number(checkUrl(activeHref, yardId).searchParams.get("pagenum")) !== page
    )
      throw new Error("Inventory returned the wrong active page");
    const numericLinks = links.filter((link) => /^\d+$/.test(link.label));
    const numericPages = numericLinks.map((link) =>
      Number(link.url.searchParams.get("pagenum")),
    );
    lastPage = Math.max(...numericPages);
    if (
      numericPages[0] !== 1 ||
      !numericPages.includes(page) ||
      lastPage >= UPULLITWA_MAX_PAGES_PER_YARD ||
      numericLinks.some(
        (link) =>
          Number(link.label) !== Number(link.url.searchParams.get("pagenum")),
      ) ||
      numericPages.some(
        (value, index) => index > 0 && value <= (numericPages[index - 1] ?? 0),
      ) ||
      (numericPages.some((value, index) => value !== index + 1) &&
        !/<span\b[^>]*>\s*(?:&hellip;|…)\s*<\/span>/i.test(contents))
    )
      throw new Error(
        "Inventory pagination is incomplete or reached the page cap",
      );
    const nextLinks = links.filter((link) => /^Next\b/i.test(link.label));
    if (nextLinks.length !== (page < lastPage ? 1 : 0))
      throw new Error("Inventory Next link contradicts numbered pages");
    const next = nextLinks[0]?.url ?? null;
    if (next && Number(next.searchParams.get("pagenum")) !== page + 1)
      throw new Error("Inventory Next link skips or repeats a page");
    const signature = JSON.stringify(
      links.map((link) => [link.label, link.url.href]),
    );
    if (previousSignature !== null && previousSignature !== signature)
      throw new Error("Inventory pagination controls disagree");
    previousSignature = signature;
    nextUrl = next?.href ?? null;
  }
  const fingerprint = createHash("sha256")
    .update(
      JSON.stringify(
        records.map((record) => [record.vin, record.stockNumber]).sort(),
      ),
    )
    .digest("hex");
  return { records, yardIds: yardIds.sort(), nextUrl, lastPage, fingerprint };
}

export function fetchUpullitwaPage(
  yardId: string,
  page: number,
  requestGate?: ProviderRequestGate,
  nextUrl?: string,
) {
  const operation = `yard ${yardId} page ${page}`;
  return Effect.try({
    try: () => {
      if (yardId !== "ANY" && !UpullitwaYardIdSchema.safeParse(yardId).success)
        throw new Error("Invalid yard ID");
      const url = checkUrl(nextUrl ?? upullitwaPageUrl(yardId, page), yardId);
      if (Number(url.searchParams.get("pagenum")) !== page)
        throw new Error("Requested page and next link disagree");
      return url.href;
    },
    catch: (cause) => new UpullitwaProviderError({ operation, cause }),
  }).pipe(
    Effect.flatMap((url) =>
      fetchProviderText({
        url,
        context: `Washington U-Pull-It ${operation}`,
        requestGate,
        retry: { retryLimit: 2, retryNetworkErrors: false, jitter: false },
        onResponse: (response) => {
          if (
            response.status === 206 ||
            response.headers.has("content-range") ||
            hasHttpPaginationLink(response.headers)
          )
            throw new Error(
              "Partial/linked HTTP inventory response; completeness cannot be verified",
            );
          if (
            response.ok &&
            !(response.headers.get("content-type") ?? "").includes("text/html")
          )
            throw new Error("Inventory response is not HTML");
          if (response.url && checkUrl(response.url, yardId).href !== url)
            throw new Error(
              "Inventory request redirected; inspect the provider route",
            );
        },
      }).pipe(
        Effect.flatMap((html) =>
          Effect.try(() => parseUpullitwaPage(html, yardId, page)),
        ),
        Effect.mapError(
          (cause) => new UpullitwaProviderError({ operation, cause }),
        ),
      ),
    ),
  );
}
