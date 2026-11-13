import {
  inventoryHtmlAttribute,
  stripInventoryRawText,
} from "./inventory-html";

export const CARS4PARTS_ORIGIN = "https://cars4parts.carzrus1.com";
export const CARS4PARTS_INVENTORY = CARS4PARTS_ORIGIN + "/inventory/";
export const CARS4PARTS_MAX_BODY_BYTES = 2 * 1024 * 1024;
const named = new Map([
  ["amp", "&"],
  ["nbsp", " "],
  ["quot", '"'],
  ["apos", "'"],
  ["lt", "<"],
  ["gt", ">"],
  ["ndash", "\u2013"],
  ["mdash", "\u2014"],
  ["rsquo", "\u2019"],
  ["lsquo", "\u2018"],
  ["hellip", "\u2026"],
]);
export function cars4partsText(raw: string): string {
  return raw
    .replace(/<[^>]*>/g, " ")
    .replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (literal: string, key: string) => {
      if (!key.startsWith("#")) return named.get(key.toLowerCase()) ?? literal;
      const hex = /^#x/i.test(key);
      const point = Number.parseInt(key.slice(hex ? 2 : 1), hex ? 16 : 10);
      return point > 0 &&
        point <= 0x10ffff &&
        !(point >= 0xd800 && point <= 0xdfff)
        ? String.fromCodePoint(point)
        : literal;
    })
    .replace(/\s+/g, " ")
    .trim();
}
export const cars4partsAttribute = (tag: string, key: string) => {
  const value = inventoryHtmlAttribute(tag, key);
  return value === null ? null : cars4partsText(value);
};
export const cars4partsClass = (tag: string, name: string) =>
  (cars4partsAttribute(tag, "class") ?? "").split(/\s+/).includes(name);

/** Balance the selected element without repairing the provider's unrelated,
 * occasionally malformed list markup into invented inventory observations. */
export function cars4partsElements(
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
  if (opening !== null) throw new Error(`Unclosed native ${name} region`);
  return blocks;
}
export function cars4partsOne(
  raw: string,
  name: string,
  selected: (tag: string) => boolean,
) {
  const blocks = cars4partsElements(raw, name, selected);
  const block = blocks[0];
  if (!block || blocks.length !== 1)
    throw new Error(`Expected one complete native ${name} region`);
  return block;
}
export function cars4partsFragment(raw: string) {
  if (!raw.trim() || Buffer.byteLength(raw) > CARS4PARTS_MAX_BODY_BYTES)
    throw new Error("Native response is empty or exceeds 2 MiB");
  return stripInventoryRawText(raw);
}
export function cars4partsDocument(raw: string) {
  const clean = cars4partsFragment(raw);
  if (
    [/<html\b/gi, /<body\b/gi, /<\/body\s*>/gi, /<\/html\s*>/gi].some(
      (pattern) => [...clean.matchAll(pattern)].length !== 1,
    ) ||
    !/<\/body\s*>\s*<\/html\s*>\s*$/i.test(clean)
  )
    throw new Error(
      "Native document is truncated or has conflicting document boundaries",
    );
  return clean;
}
export function cars4partsOwnedUrl(raw: string): URL | null {
  const url = URL.parse(raw, CARS4PARTS_ORIGIN);
  return url &&
    url.origin === CARS4PARTS_ORIGIN &&
    !url.username &&
    !url.password &&
    !url.search &&
    !url.hash
    ? url
    : null;
}
export function cars4partsLeafUrl(raw: string): string | null {
  const url = cars4partsOwnedUrl(raw);
  return url && /^\/inventory\/[^/]+\/$/.test(url.pathname) ? url.href : null;
}
