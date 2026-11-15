import {
  inventoryHtmlAttribute,
  stripInventoryRawText,
} from "~/server/ingestion/inventory-html";

export const WEBERBROTHERS_MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const entities = new Map([
  ["amp", "&"],
  ["nbsp", " "],
  ["quot", '"'],
  ["apos", "'"],
  ["lt", "<"],
  ["gt", ">"],
  ["rsquo", "'"],
  ["lsquo", "'"],
  ["rdquo", '"'],
  ["ldquo", '"'],
  ["ndash", "-"],
  ["mdash", "-"],
  ["hellip", "…"],
  ["copy", "©"],
  ["reg", "®"],
  ["trade", "™"],
]);
export function weberbrothersText(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (raw: string, key: string) => {
      if (!key.startsWith("#")) {
        const value = entities.get(key.toLowerCase());
        if (value === undefined)
          throw new Error("Unsupported Weber entity " + raw);
        return value;
      }
      const hex = /^#x/i.test(key);
      const code = Number.parseInt(key.slice(hex ? 2 : 1), hex ? 16 : 10);
      if (
        !Number.isSafeInteger(code) ||
        code <= 0 ||
        code > 0x10ffff ||
        (code >= 0xd800 && code <= 0xdfff)
      )
        throw new Error("Invalid Weber character reference");
      return String.fromCodePoint(code);
    })
    .replace(/\s+/g, " ")
    .trim();
}
export const weberbrothersHasClass = (tag: string, name: string) =>
  (inventoryHtmlAttribute(tag, "class") ?? "").split(/\s+/).includes(name);

/** Balanced selected divs preserve the donor/field boundary. */
export function weberbrothersDivs(
  html: string,
  className: string,
  allowNested = false,
) {
  const blocks: { tag: string; html: string; body: string }[] = [];
  let current: { start: number; body: number; tag: string } | null = null;
  let depth = 0;
  for (const match of html.matchAll(/<\/?div\b[^>]*>/gi)) {
    const tag = match[0];
    if (current === null) {
      if (!/^<\//.test(tag) && weberbrothersHasClass(tag, className)) {
        current = { start: match.index, body: match.index + tag.length, tag };
        depth = 1;
      }
    } else if (/^<\//.test(tag)) {
      if (--depth === 0) {
        blocks.push({
          tag: current.tag,
          html: html.slice(current.start, match.index + tag.length),
          body: html.slice(current.body, match.index),
        });
        current = null;
      }
    } else {
      if (!allowNested && weberbrothersHasClass(tag, className))
        throw new Error("Nested Weber " + className);
      depth++;
    }
  }
  if (current !== null) throw new Error("Unclosed Weber " + className);
  return blocks;
}
export function weberbrothersOneDiv(
  html: string,
  className: string,
  allowNested = false,
) {
  const blocks = weberbrothersDivs(html, className, allowNested);
  const block = blocks[0];
  if (blocks.length !== 1 || !block)
    throw new Error("Expected one Weber " + className);
  return block;
}
export function weberbrothersDocument(raw: string): string {
  const clean = stripInventoryRawText(raw);
  if (
    Buffer.byteLength(raw) > WEBERBROTHERS_MAX_RESPONSE_BYTES ||
    !/<\/html\s*>\s*$/i.test(clean)
  )
    throw new Error("Weber document is oversized or truncated");
  const footers = [
    ...clean.matchAll(/<footer\b[^>]*>([\s\S]*?)<\/footer\s*>/gi),
  ];
  const footer = weberbrothersText(footers[0]?.[1] ?? "");
  if (
    footers.length !== 1 ||
    !footer.includes(
      "Weber Brothers Auto 1325 East Main Street Unit 1 Annville, PA 17003-1612",
    ) ||
    /<title\b[^>]*>[^<]*(?:access denied|just a moment|captcha|security check)/i.test(
      clean,
    )
  )
    throw new Error("Weber native owner/address or access content changed");
  return clean;
}
