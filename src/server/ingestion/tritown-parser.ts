import { tritownVehiclePhoto } from "./vehicle-photo";
import { z } from "zod";
import {
  inventoryHtmlAttribute,
  stripInventoryRawText,
} from "./inventory-html";
import { TRITOWN_ORIGIN, TRITOWN_YARD } from "./tritown-yard-metadata";

export const TRITOWN_MAX_PAGES = 2_000;
export const TRITOWN_PAGE_SIZE = 5;
export interface TritownContext {
  nonce: string;
  makes: string[];
}
export interface TritownRecord {
  title: string;
  vin: string;
  description: string;
  donorUrl: string;
  imageUrl?: string | null;
}

function text(raw: string): string {
  const named = new Map([
    ["amp", "&"],
    ["lt", "<"],
    ["gt", ">"],
    ["quot", '"'],
    ["apos", "'"],
    ["nbsp", " "],
    ["raquo", "»"],
    ["hellip", "..."],
  ]);
  return raw
    .replace(/<[^>]*>/g, " ")
    .replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (entity: string, key: string) => {
      if (!key.startsWith("#")) {
        const value = named.get(key.toLowerCase());
        if (value === undefined)
          throw new Error("Unsupported TriTown entity " + entity);
        return value;
      }
      const hex = /^#x/i.test(key);
      const point = Number.parseInt(key.slice(hex ? 2 : 1), hex ? 16 : 10);
      if (
        point <= 0 ||
        point > 0x10ffff ||
        (point >= 0xd800 && point <= 0xdfff)
      )
        throw new Error("Invalid TriTown character reference");
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

/** Revalidate the native current-inventory statement and physical owner each chunk. */
export function parseTritownContext(raw: string): TritownContext {
  if (Buffer.byteLength(raw) > 2_000_000 || !/<\/html>\s*$/i.test(raw))
    throw new Error("TriTown inventory page is oversized or truncated");
  const html = stripInventoryRawText(raw);
  const body = text(html);
  if (
    !body.includes(TRITOWN_YARD.address) ||
    !body.includes("Mount Joy, PA 17552") ||
    !body.replace(/\D/g, "").includes("7174095279") ||
    !body.includes(
      "The list below represents the most up to date inventory at our location in Mount Joy.",
    )
  )
    throw new Error(
      "TriTown physical ownership or current active inventory statement changed",
    );
  const config = [...raw.matchAll(/\bvar\s+wpcm\s*=\s*(\{[^;\n]*\})\s*;/g)];
  const configBody = config[0]?.[1];
  if (config.length !== 1 || configBody === undefined)
    throw new Error("TriTown native listing endpoint is missing or ambiguous");
  z.object({
    ajax_url_get_vehicles: z.literal(
      TRITOWN_ORIGIN + "/?wpcm-ajax=get_vehicle_results",
    ),
  }).parse(JSON.parse(configBody));
  const nonces = [...html.matchAll(/<input\b[^>]*>/gi)].filter(
    ([tag]) => attr(tag, "id") === "wpcm-listings-nonce",
  );
  const nonce = attr(nonces[0]?.[0] ?? "", "value");
  if (nonces.length !== 1 || !nonce || !/^[a-f0-9]{10}$/.test(nonce))
    throw new Error("TriTown native listing nonce is missing or invalid");
  const selectors = [
    ...html.matchAll(/<select\b([^>]*)>([\s\S]*?)<\/select>/gi),
  ];
  const makeSelectors = selectors.filter(
    (m) => attr(m[1] ?? "", "name") === "make",
  );
  const makeHtml = makeSelectors[0]?.[2];
  const makes = [
    ...(makeHtml ?? "").matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option>/gi),
  ]
    .filter((m) => attr(m[1] ?? "", "value") !== "0")
    .map((m) => text(m[2] ?? ""));
  const sort = selectors.filter((m) => attr(m[1] ?? "", "id") === "wpcm-sort");
  const sortOptions = [...(sort[0]?.[2] ?? "").matchAll(/<option\b[^>]*>/gi)];
  if (
    makeSelectors.length !== 1 ||
    makes.length < 1 ||
    makes.length > 100 ||
    new Set(makes).size !== makes.length ||
    makes.some((m) => !m || m.length > 100) ||
    sort.length !== 1 ||
    !sortOptions.some(([tag]) => attr(tag, "value") === "power_kw-asc")
  )
    throw new Error(
      "TriTown native make directory or complete-catalog sort changed",
    );
  return { nonce, makes };
}

const responseSchema = z
  .object({
    listings: z.string().max(200_000),
    pagination: z.string().min(1).max(50_000),
  })
  .strict();

/** Native AJAX responses contain nested metadata li elements inside each donor. */
export function parseTritownPage(raw: string, requestedPage: number) {
  const response = responseSchema.parse(JSON.parse(raw));
  const pagination = stripInventoryRawText(response.pagination);
  const current = [
    ...pagination.matchAll(/<span\b([^>]*)>([\s\S]*?)<\/span>/gi),
  ].filter((m) => hasClass(m[1] ?? "", "current"));
  const anchors = [...pagination.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)];
  const numbered = anchors.flatMap((m) => {
    const page = attr(m[1] ?? "", "data-page");
    return page && /^\d+$/.test(page) ? [Number(page)] : [];
  });
  const lastPage = Math.max(requestedPage, ...numbered);
  const next = anchors.filter((m) => hasClass(m[1] ?? "", "next"));
  const previous = anchors.filter((m) => hasClass(m[1] ?? "", "prev"));
  if (
    current.length !== 1 ||
    text(current[0]?.[2] ?? "") !== String(requestedPage) ||
    !Number.isSafeInteger(requestedPage) ||
    requestedPage < 1 ||
    lastPage > TRITOWN_MAX_PAGES ||
    numbered.some((n) => n < 1 || n === requestedPage) ||
    next.length !== (requestedPage < lastPage ? 1 : 0) ||
    (next.length === 1 && attr(next[0]?.[1] ?? "", "data-page") !== "next") ||
    previous.length !== (requestedPage > 1 ? 1 : 0) ||
    (previous.length === 1 &&
      attr(previous[0]?.[1] ?? "", "data-page") !== "prev")
  )
    throw new Error(
      "TriTown pagination ignored the requested page or changed its terminal contract",
    );
  const html = stripInventoryRawText(response.listings);
  const starts = [...html.matchAll(/<li\b[^>]*>/gi)].filter(([tag]) =>
    hasClass(tag, "wpcm-listings-item"),
  );
  if (!starts.length || html.slice(0, starts[0]?.index).trim())
    throw new Error("TriTown listing response has no complete donor cards");
  const records: TritownRecord[] = starts.map((start, index) => {
    const block = html
      .slice(start.index + start[0].length, starts[index + 1]?.index)
      .trim();
    if (!/<\/a>\s*<\/li>$/i.test(block))
      throw new Error("TriTown donor card is truncated");
    const headings = [...block.matchAll(/<h3\b[^>]*>([\s\S]*?)<\/h3>/gi)];
    const links = [...block.matchAll(/<a\b[^>]*>/gi)];
    const donorUrl = attr(links[0]?.[0] ?? "", "href");
    const url = donorUrl ? URL.parse(donorUrl) : null;
    if (
      headings.length !== 1 ||
      links.length !== 1 ||
      !url ||
      url.origin !== TRITOWN_ORIGIN ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !/^\/vehicle\/[a-z0-9_-]+\/$/.test(url.pathname)
    )
      throw new Error(
        "TriTown donor identity or physical-owner destination is missing or changed",
      );
    const descriptions = [...block.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)];
    if (descriptions.length > 1)
      throw new Error("TriTown donor description is ambiguous");
    const description = text(descriptions[0]?.[1] ?? "");
    if (
      /\b(?:sold|crushed|crush|hold|unavailable|removed|pending)\b/i.test(
        description,
      )
    )
      throw new Error(
        "TriTown current catalog contains an unavailable or held donor",
      );
    const identities = [...description.matchAll(/\bvin\s*#?\s*([a-z0-9]+)/gi)];
    return {
      imageUrl:
        [...block.matchAll(/<img\b[^>]*>/gi)]
          .filter(([tag]) => hasClass(tag, "wpcm-listings-item-image"))
          .map(([tag]) =>
            tritownVehiclePhoto(attr(tag, "data-src") ?? attr(tag, "src")),
          )
          .find((url) => url !== null) ?? null,
      title: text(headings[0]?.[1] ?? ""),
      description,
      vin: identities.length === 1 ? (identities[0]?.[1] ?? "") : "",
      donorUrl: url.href,
    };
  });
  if (
    records.length > TRITOWN_PAGE_SIZE ||
    (requestedPage < lastPage && records.length !== TRITOWN_PAGE_SIZE)
  )
    throw new Error(
      "TriTown pagination returned a short or oversized nonterminal page",
    );
  return { records, lastPage };
}
