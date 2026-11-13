import {
  inventoryHtmlAttribute,
  stripInventoryRawText,
} from "./inventory-html";

export function coutuText(raw: string): string {
  return raw
    .replace(/<[^>]*>/g, " ")
    .replace(
      /&(amp|nbsp|quot|apos|lt|gt|#\d+|#x[\da-f]+);/gi,
      (entity, key: string) => {
        const named: Record<string, string> = {
          amp: "&",
          nbsp: " ",
          quot: '"',
          apos: "'",
          lt: "<",
          gt: ">",
        };
        if (!key.startsWith("#")) return named[key.toLowerCase()] ?? entity;
        const point =
          key[1]?.toLowerCase() === "x"
            ? Number.parseInt(key.slice(2), 16)
            : Number(key.slice(1));
        return Number.isInteger(point) && point > 0 && point <= 0x10ffff
          ? String.fromCodePoint(point)
          : entity;
      },
    )
    .replace(/\s+/g, " ")
    .trim();
}

/** Balanced, outermost elements. Never repair a truncated inventory region. */
export function coutuElements(
  html: string,
  name: string,
  matches: (tag: string) => boolean = () => true,
) {
  const blocks: { tag: string; body: string }[] = [];
  let opening: { end: number; tag: string } | null = null;
  let depth = 0;
  for (const match of html.matchAll(
    new RegExp(`<\\/?${name}\\b[^>]*>`, "gi"),
  )) {
    const tag = match[0];
    if (!opening) {
      if (!tag.startsWith("</") && matches(tag)) {
        opening = { end: match.index + tag.length, tag };
        depth = 1;
      }
    } else if (tag.startsWith("</")) {
      if (--depth === 0) {
        blocks.push({
          tag: opening.tag,
          body: html.slice(opening.end, match.index),
        });
        opening = null;
      }
    } else depth++;
  }
  if (opening) throw new Error("Unclosed Coutu " + name + " region");
  return blocks;
}

export function coutuRegion(html: string, name: string, id?: string): string {
  const regions = coutuElements(
    html,
    name,
    (tag) => id === undefined || inventoryHtmlAttribute(tag, "id") === id,
  );
  const region = regions[0];
  if (regions.length !== 1 || !region)
    throw new Error("Expected one Coutu " + (id ?? name) + " region");
  return region.body;
}

export function coutuDocument(raw: string): string {
  const html = stripInventoryRawText(raw);
  if (
    Buffer.byteLength(raw) > 2 * 1024 * 1024 ||
    !/<\/html\s*>\s*$/i.test(html)
  )
    throw new Error("Coutu document is oversized or truncated");
  const footer = coutuText(coutuRegion(html, "footer"));
  const phone = [...html.matchAll(/<a\b[^>]*>/gi)].some(
    ([tag]) =>
      inventoryHtmlAttribute(tag, "href")?.replace(/[^\d]/g, "") ===
      "8604236004",
  );
  if (
    !footer.includes("Truck Country") ||
    !footer.includes("1535 W Main St") ||
    !footer.includes("Willimantic, CT 06226") ||
    !phone
  )
    throw new Error("Coutu native yard identity, address or phone changed");
  return html;
}
