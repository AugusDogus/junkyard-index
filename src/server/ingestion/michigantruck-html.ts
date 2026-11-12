import {
  inventoryHtmlAttribute,
  stripInventoryRawText,
} from "./inventory-html";

export function michigantruckText(raw: string): string {
  const named = new Map([
    ["amp", "&"],
    ["lt", "<"],
    ["gt", ">"],
    ["quot", '"'],
    ["apos", "'"],
    ["nbsp", " "],
  ]);
  return raw
    .replace(/<[^>]*>/g, " ")
    .replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (entity: string, key: string) => {
      if (!key.startsWith("#")) {
        const value = named.get(key.toLowerCase());
        if (value === undefined)
          throw new Error("Unsupported Michigan Truck entity " + entity);
        return value;
      }
      const hex = /^#x/i.test(key);
      const point = Number.parseInt(key.slice(hex ? 2 : 1), hex ? 16 : 10);
      if (
        point <= 0 ||
        point > 0x10ffff ||
        (point >= 0xd800 && point <= 0xdfff)
      )
        throw new Error("Invalid Michigan Truck character reference");
      return String.fromCodePoint(point);
    })
    .replace(/\s+/g, " ")
    .trim();
}
export function michigantruckAttribute(
  tag: string,
  name: string,
): string | null {
  const value = inventoryHtmlAttribute(tag, name);
  if (value !== null && /[<>]/.test(value))
    throw new Error("Malformed Michigan Truck attribute " + name);
  return value === null ? null : michigantruckText(value);
}
export const michigantruckHasClass = (tag: string, name: string) =>
  (michigantruckAttribute(tag, "class") ?? "").split(/\s+/).includes(name);

/** Balanced native div subtrees. Truncated or nested catalog cards are errors. */
export function michigantruckDivs(html: string, className: string): string[] {
  const blocks: string[] = [];
  let start: number | null = null;
  let depth = 0;
  for (const match of html.matchAll(/<\/?div\b[^>]*>/gi)) {
    const tag = match[0];
    if (start === null) {
      if (!/^<\//.test(tag) && michigantruckHasClass(tag, className)) {
        start = match.index;
        depth = 1;
      }
    } else if (/^<\//.test(tag)) {
      if (--depth === 0) {
        blocks.push(html.slice(start, match.index + tag.length));
        start = null;
      }
    } else {
      if (michigantruckHasClass(tag, className))
        throw new Error("Nested Michigan Truck " + className);
      depth++;
    }
  }
  if (start !== null) throw new Error("Unclosed Michigan Truck " + className);
  return blocks;
}

export function michigantruckDocument(raw: string): string {
  if (Buffer.byteLength(raw) > 4_000_000 || !/<\/html\s*>\s*$/i.test(raw))
    throw new Error("Michigan Truck document is oversized or truncated");
  const html = stripInventoryRawText(raw);
  // Ownership is present on every native catalog and detail footer.
  const visible = html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");
  const phone = [...html.matchAll(/<a\b[^>]*>/gi)].some(
    ([tag]) =>
      (inventoryHtmlAttribute(tag, "href") ?? "").replace(/\D/g, "") ===
        "17347223800" &&
      (inventoryHtmlAttribute(tag, "href") ?? "").startsWith("tel:"),
  );
  if (!visible.includes("38658 Ford Rd, Westland, MI 48185") || !phone)
    throw new Error("Michigan Truck physical yard address or phone changed");
  return html;
}
