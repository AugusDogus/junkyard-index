import {
  inventoryHtmlAttribute,
  stripInventoryRawText,
} from "./inventory-html";

export const PRATT_ORIGIN = "https://prattsautosalvage.com";
export const PRATT_MAKES = PRATT_ORIGIN + "/parts/makes/";
export const PRATT_ARRIVALS = PRATT_ORIGIN + "/latest-arrivals/";
export const PRATT_IMAGE_PREFIX =
  "https://da8h1v3w8q6n5.cloudfront.net/ar18/images/";

export function prattText(raw: string): string {
  const named = new Map([
    ["amp", "&"],
    ["nbsp", " "],
    ["quot", '"'],
    ["apos", "'"],
    ["lt", "<"],
    ["gt", ">"],
  ]);
  return raw
    .replace(/<[^>]*>/g, " ")
    .replace(
      /&(#x[\da-f]+|#\d+|amp|nbsp|quot|apos|lt|gt);/gi,
      (literal: string, key: string) => {
        if (!key.startsWith("#"))
          return named.get(key.toLowerCase()) ?? literal;
        const point = Number.parseInt(
          key.slice(/^#x/i.test(key) ? 2 : 1),
          /^#x/i.test(key) ? 16 : 10,
        );
        return point > 0 &&
          point <= 0x10ffff &&
          !(point >= 0xd800 && point <= 0xdfff)
          ? String.fromCodePoint(point)
          : literal;
      },
    )
    .replace(/\s+/g, " ")
    .trim();
}
export const prattAttribute = (tag: string, key: string) => {
  const value = inventoryHtmlAttribute(tag, key);
  return value === null ? null : prattText(value);
};
export const prattClass = (tag: string, name: string) =>
  (prattAttribute(tag, "class") ?? "").split(/\s+/).includes(name);

/** Balanced native elements. Never repair partial HTML into a complete catalog. */
export function prattElements(
  raw: string,
  name: string,
  selected: (tag: string) => boolean = () => true,
) {
  const blocks: { tag: string; body: string }[] = [];
  let opening: { tag: string; end: number } | null = null;
  let depth = 0;
  for (const match of raw.matchAll(new RegExp(`<\\/?${name}\\b[^>]*>`, "gi"))) {
    const tag = match[0];
    if (opening === null) {
      if (!tag.startsWith("</") && selected(tag)) {
        opening = { tag, end: match.index + tag.length };
        depth = 1;
      }
    } else if (tag.startsWith("</")) {
      if (--depth === 0) {
        blocks.push({
          tag: opening.tag,
          body: raw.slice(opening.end, match.index),
        });
        opening = null;
      }
    } else depth++;
  }
  if (opening !== null) throw new Error("Unclosed native " + name + " region");
  return blocks;
}
export function prattRegion(
  raw: string,
  selected: (tag: string) => boolean,
): string {
  const blocks = prattElements(raw, "div", selected);
  const region = blocks[0];
  if (!region || blocks.length !== 1)
    throw new Error("Expected one complete native inventory region");
  return region.body;
}
export function prattDocument(raw: string): string {
  const html = stripInventoryRawText(raw);
  if (
    Buffer.byteLength(raw) > 2 * 1024 * 1024 ||
    [/<html\b/gi, /<body\b/gi, /<\/body\s*>/gi, /<\/html\s*>/gi].some(
      (pattern) => [...html.matchAll(pattern)].length !== 1,
    ) ||
    !/<\/body\s*>\s*<\/html\s*>\s*$/i.test(html)
  )
    throw new Error("Native response is oversized or truncated");
  const suppliers = [...raw.matchAll(/\bvar\s+urgid\s*=\s*(['"])(.*?)\1\s*;/g)];
  if (!suppliers.length || suppliers.some((match) => match[2] !== "AR18"))
    throw new Error("Native AR18 supplier is missing or conflicting");
  return html;
}
export function prattOwnedUrl(raw: string, base = PRATT_ORIGIN): URL | null {
  const url = URL.parse(raw, base);
  return url &&
    url.origin === PRATT_ORIGIN &&
    !url.username &&
    !url.password &&
    !url.hash
    ? url
    : null;
}
export function prattBrowsePath(raw: string, depth: 1 | 2): string | null {
  const url = prattOwnedUrl(raw);
  return url &&
    !url.search &&
    /^\/parts\/[^/]+(?:\/[^/]+)?\/?$/.test(url.pathname) &&
    url.pathname.split("/").filter(Boolean).length === depth + 1 &&
    url.pathname.replace(/\/$/, "") !== "/parts/makes"
    ? url.pathname
    : null;
}
/** Only the provider's published literal delimiter, never an alias lookup. */
export const prattRouteLabel = (value: string) =>
  value
    .replace(/_/g, " ")
    .replace(/\+/g, ",")
    .replace(/\./g, "/")
    .replace(/~/g, "-")
    .replace(/and_/g, "&");

export function prattContinuation(raw: string) {
  const controls: string[] = [];
  for (const match of raw.matchAll(
    /<(a|button)\b([^>]*)>([\s\S]*?)<\/\1\s*>/gi,
  )) {
    const attrs = match[2] ?? "";
    if (
      /paginat|page-link|page-numbers|load.?more/i.test(
        prattAttribute(attrs, "class") ?? "",
      ) ||
      /\b(?:next|prev|last)\b/i.test(prattAttribute(attrs, "rel") ?? "") ||
      /[?&](?:page|paged|p|offset|start)=\d+|\/page\/\d+(?:[/?#]|$)/i.test(
        prattAttribute(attrs, "href") ?? "",
      ) ||
      /^(?:next(?: page)?|previous(?: page)?|load more|show more)$/i.test(
        prattText(match[3] ?? ""),
      )
    )
      controls.push(match[0]);
  }
  for (const [tag] of raw.matchAll(/<(?:div|nav|ul|li|button|input)\b[^>]*>/gi))
    if (
      /paginat|page-numbers|load.?more/i.test(
        prattAttribute(tag, "class") ?? "",
      ) ||
      ["data-next-page", "data-next-url", "data-next-cursor"].some(
        (key) => prattAttribute(tag, key) !== null,
      )
    )
      controls.push(tag);
  for (const match of prattText(raw).matchAll(
    /\b(?:displaying|showing)\s+(\d+)(?:\s*-\s*(\d+))?\s+of\s+(\d+)/gi,
  ))
    if (Number(match[2] ?? match[1]) < Number(match[3]))
      controls.push(match[0]);
  return controls;
}
