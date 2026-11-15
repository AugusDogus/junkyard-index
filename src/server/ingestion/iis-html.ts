import { inventoryHtmlAttribute } from "./inventory-html";

export function iisText(raw: string): string {
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
export const iisAttribute = (tag: string, key: string) => {
  const value = inventoryHtmlAttribute(tag, key);
  return value === null ? null : iisText(value);
};
export const iisClass = (tag: string, name: string) =>
  (iisAttribute(tag, "class") ?? "").split(/\s+/).includes(name);

/** Balanced native elements. Never repair partial HTML into a complete catalog. */
export function iisElements(
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
export function iisRegion(
  raw: string,
  selected: (tag: string) => boolean,
): string {
  const blocks = iisElements(raw, "div", selected);
  const region = blocks[0];
  if (!region || blocks.length !== 1)
    throw new Error("Expected one complete native inventory region");
  return region.body;
}
/** Only the provider's published literal delimiter, never an alias lookup. */
export const iisRouteLabel = (value: string) =>
  value
    .replace(/_/g, " ")
    .replace(/\+/g, ",")
    .replace(/\./g, "/")
    .replace(/~/g, "-")
    .replace(/and_/g, "&");

export function iisContinuation(raw: string) {
  const controls: string[] = [];
  for (const match of raw.matchAll(
    /<(a|button)\b([^>]*)>([\s\S]*?)<\/\1\s*>/gi,
  )) {
    const attrs = match[2] ?? "";
    if (
      /paginat|page-link|page-numbers|load.?more/i.test(
        iisAttribute(attrs, "class") ?? "",
      ) ||
      /\b(?:next|prev|last)\b/i.test(iisAttribute(attrs, "rel") ?? "") ||
      /[?&](?:page|paged|p|offset|start)=\d+|\/page\/\d+(?:[/?#]|$)/i.test(
        iisAttribute(attrs, "href") ?? "",
      ) ||
      /^(?:next(?: page)?|previous(?: page)?|load more|show more)$/i.test(
        iisText(match[3] ?? ""),
      )
    )
      controls.push(match[0]);
  }
  for (const [tag] of raw.matchAll(/<(?:div|nav|ul|li|button|input)\b[^>]*>/gi))
    if (
      /paginat|page-numbers|load.?more/i.test(
        iisAttribute(tag, "class") ?? "",
      ) ||
      ["data-next-page", "data-next-url", "data-next-cursor"].some(
        (key) => iisAttribute(tag, key) !== null,
      )
    )
      controls.push(tag);
  for (const match of iisText(raw).matchAll(
    /\b(?:displaying|showing)\s+(\d+)(?:\s*-\s*(\d+))?\s+of\s+(\d+)/gi,
  ))
    if (Number(match[2] ?? match[1]) < Number(match[3]))
      controls.push(match[0]);
  return controls;
}
