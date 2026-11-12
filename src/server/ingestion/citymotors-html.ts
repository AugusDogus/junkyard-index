import {
  inventoryHtmlAttribute,
  stripInventoryRawText,
} from "./inventory-html";

export const citymotorsHasClass = (tag: string, name: string) =>
  (inventoryHtmlAttribute(tag, "class") ?? "").split(/\s+/).includes(name);
export function citymotorsText(raw: string): string {
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
    ["hellip", "..."],
  ]);
  return raw
    .replace(/<[^>]*>/g, " ")
    .replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (entity: string, key: string) => {
      if (!key.startsWith("#")) {
        const value = entities.get(key.toLowerCase());
        if (value === undefined)
          throw new Error("Unsupported City Motors entity " + entity);
        return value;
      }
      const hex = /^#x/i.test(key);
      const code = Number.parseInt(key.slice(hex ? 2 : 1), hex ? 16 : 10);
      if (code <= 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff))
        throw new Error("Invalid City Motors character reference");
      return String.fromCodePoint(code);
    })
    .replace(/\s+/g, " ")
    .trim();
}
/** Balanced native div regions keep primary identity separate from retail parts. */
export function citymotorsDivs(html: string, className: string): string[] {
  const blocks: string[] = [];
  let start: number | null = null;
  let depth = 0;
  for (const match of html.matchAll(/<\/?div\b[^>]*>/gi)) {
    const tag = match[0];
    if (start === null) {
      if (!/^<\//.test(tag) && citymotorsHasClass(tag, className)) {
        start = match.index;
        depth = 1;
      }
    } else if (/^<\//.test(tag)) {
      if (--depth === 0) {
        blocks.push(html.slice(start, match.index + tag.length));
        start = null;
      }
    } else {
      if (citymotorsHasClass(tag, className))
        throw new Error("Nested City Motors " + className);
      depth++;
    }
  }
  if (start !== null) throw new Error("Unclosed City Motors " + className);
  return blocks;
}
export function citymotorsDocument(raw: string): string {
  const clean = stripInventoryRawText(raw);
  if (
    Buffer.byteLength(raw) > 2 * 1024 * 1024 ||
    !/<\/html\s*>\s*$/i.test(clean)
  )
    throw new Error("City Motors document is oversized or truncated");
  return clean;
}
