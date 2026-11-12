import {
  inventoryHtmlAttribute,
  stripInventoryRawText,
} from "./inventory-html";

export function mccauleyText(html: string): string {
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
  ]);
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (raw: string, key: string) => {
      if (!key.startsWith("#")) {
        const value = entities.get(key.toLowerCase());
        if (value === undefined)
          throw new Error("Unsupported McCauley entity " + raw);
        return value;
      }
      const hex = /^#x/i.test(key);
      const code = Number.parseInt(key.slice(hex ? 2 : 1), hex ? 16 : 10);
      if (code <= 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff))
        throw new Error("Invalid McCauley character reference");
      return String.fromCodePoint(code);
    })
    .replace(/\s+/g, " ")
    .trim();
}

export const mccauleyHasClass = (tag: string, name: string) =>
  (inventoryHtmlAttribute(tag, "class") ?? "").split(/\s+/).includes(name);

/** Retain whole native cards/paragraphs rather than searching global VIN text. */
export function mccauleyDivs(html: string, className: string): string[] {
  const blocks: string[] = [];
  let start: number | null = null;
  let depth = 0;
  for (const match of html.matchAll(/<\/?div\b[^>]*>/gi)) {
    const tag = match[0];
    if (start === null) {
      if (!/^<\//.test(tag) && mccauleyHasClass(tag, className)) {
        start = match.index;
        depth = 1;
      }
    } else if (/^<\//.test(tag)) {
      if (--depth === 0) {
        blocks.push(html.slice(start, match.index + tag.length));
        start = null;
      }
    } else {
      if (mccauleyHasClass(tag, className))
        throw new Error("Nested McCauley " + className);
      depth++;
    }
  }
  if (start !== null) throw new Error("Unclosed McCauley " + className);
  return blocks;
}

export function mccauleyDocument(raw: string): string {
  if (Buffer.byteLength(raw) > 2 * 1024 * 1024 || !/<\/html\s*>\s*$/i.test(raw))
    throw new Error("McCauley document is oversized or truncated");
  return stripInventoryRawText(raw);
}
