import { createHash } from "node:crypto";
import {
  inventoryHtmlAttribute,
  stripInventoryRawText,
} from "./inventory-html";
import { DUTCHERS_MAX_BYTES } from "./dutchers-yard-metadata";

export const dutchersHash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const entities = new Map([
  ["amp", "&"],
  ["quot", '"'],
  ["apos", "'"],
  ["nbsp", " "],
  ["lt", "<"],
  ["gt", ">"],
]);
export function dutchersText(value: string): string {
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (entity: string, key: string) => {
      if (!key.startsWith("#"))
        return entities.get(key.toLowerCase()) ?? entity;
      const hex = /^#x/i.test(key);
      const point = Number.parseInt(key.slice(hex ? 2 : 1), hex ? 16 : 10);
      if (
        point <= 0 ||
        point > 0x10ffff ||
        (point >= 0xd800 && point <= 0xdfff)
      )
        throw new Error("Dutcher HTML contains an invalid character reference");
      return String.fromCodePoint(point);
    })
    .replace(/\s+/g, " ")
    .trim();
}
export function dutchersDocument(raw: string): string {
  const clean = stripInventoryRawText(raw);
  if (
    Buffer.byteLength(raw) > DUTCHERS_MAX_BYTES ||
    !/<\/body>\s*<\/html>\s*$/i.test(clean)
  )
    throw new Error("Dutcher document is oversized or truncated");
  return clean;
}
export function dutchersDivs(raw: string, className: string): string[] {
  const starts = [...raw.matchAll(/<div\b[^>]*>/gi)].filter(([tag]) =>
    inventoryHtmlAttribute(tag, "class")?.split(/\s+/).includes(className),
  );
  return starts.map((start) => {
    const tail = raw.slice(start.index);
    let depth = 0;
    for (const tag of tail.matchAll(/<\/?div\b[^>]*>/gi)) {
      depth += /^<\//.test(tag[0]) ? -1 : 1;
      if (depth === 0) return tail.slice(0, tag.index + tag[0].length);
    }
    throw new Error("Dutcher inventory contains an incomplete div");
  });
}
export const dutchersAnchors = (raw: string) =>
  [...raw.matchAll(/(<a\b[^>]*>)([\s\S]*?)<\/a>/gi)].map((a) => ({
    href: dutchersText(inventoryHtmlAttribute(a[1] ?? "", "href") ?? ""),
    text: dutchersText(a[2] ?? ""),
  }));
