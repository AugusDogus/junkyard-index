import { createHash } from "node:crypto";
import {
  inventoryHtmlAttribute,
  stripInventoryRawText,
} from "./inventory-html";
const MAX_BYTES = 2 * 1024 * 1024;

export const heavyTruckPartsHash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const entities = new Map([
  ["amp", "&"],
  ["quot", '"'],
  ["apos", "'"],
  ["nbsp", " "],
  ["lt", "<"],
  ["gt", ">"],
]);
export function heavyTruckPartsText(value: string): string {
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
        throw new Error(
          "HeavyTruckParts HTML contains an invalid character reference",
        );
      return String.fromCodePoint(point);
    })
    .replace(/\s+/g, " ")
    .trim();
}
export function heavyTruckPartsDocument(raw: string): string {
  const clean = stripInventoryRawText(raw);
  if (
    Buffer.byteLength(raw) > MAX_BYTES ||
    !/<\/body>\s*<\/html>\s*$/i.test(clean)
  )
    throw new Error("HeavyTruckParts document is oversized or truncated");
  return clean;
}
export function heavyTruckPartsDivs(raw: string, className: string): string[] {
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
    throw new Error("HeavyTruckParts inventory contains an incomplete div");
  });
}
export const heavyTruckPartsAnchors = (raw: string) =>
  [...raw.matchAll(/(<a\b[^>]*>)([\s\S]*?)<\/a>/gi)].map((a) => ({
    href: heavyTruckPartsText(inventoryHtmlAttribute(a[1] ?? "", "href") ?? ""),
    text: heavyTruckPartsText(a[2] ?? ""),
  }));
