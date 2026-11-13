import {
  inventoryHtmlAttribute,
  stripInventoryRawText,
} from "./inventory-html";

export const aplusClass = (tag: string, name: string) =>
  (inventoryHtmlAttribute(tag, "class") ?? "").split(/\s+/).includes(name);

export function aplusText(raw: string): string {
  return raw
    .replace(/<[^>]*>/g, " ")
    .replace(
      /&(amp|nbsp|quot|apos|lt|gt|#\d{1,7}|#x[0-9a-f]{1,6});/gi,
      (entity, key: string) => {
        if (key.startsWith("#")) {
          const point = /^#x/i.test(key)
            ? Number.parseInt(key.slice(2), 16)
            : Number(key.slice(1));
          return point > 0 &&
            point <= 0x10ffff &&
            !(point >= 0xd800 && point <= 0xdfff)
            ? String.fromCodePoint(point)
            : entity;
        }
        switch (key.toLowerCase()) {
          case "amp":
            return "&";
          case "nbsp":
            return " ";
          case "quot":
            return '"';
          case "apos":
            return "'";
          case "lt":
            return "<";
          case "gt":
            return ">";
          default:
            return entity;
        }
      },
    )
    .replace(/\s+/g, " ")
    .trim();
}

export function aplusDivs(
  html: string,
  name: string,
  matches: (tag: string) => boolean = (tag) => aplusClass(tag, name),
) {
  const blocks: { tag: string; body: string }[] = [];
  let opening: { index: number; end: number; tag: string } | null = null;
  let depth = 0;
  for (const match of html.matchAll(/<\/?div\b[^>]*>/gi)) {
    const tag = match[0];
    if (opening === null) {
      if (!/^<\//.test(tag) && matches(tag)) {
        opening = { index: match.index, end: match.index + tag.length, tag };
        depth = 1;
      }
    } else if (/^<\//.test(tag)) {
      if (--depth === 0) {
        blocks.push({
          tag: opening.tag,
          body: html.slice(opening.end, match.index),
        });
        opening = null;
      }
    } else {
      if (matches(tag)) throw new Error("Nested Aplus " + name);
      depth++;
    }
  }
  if (opening !== null) throw new Error("Unclosed Aplus " + name);
  return blocks;
}

export function aplusDocument(raw: string): string {
  const html = stripInventoryRawText(raw);
  if (
    Buffer.byteLength(raw) > 2 * 1024 * 1024 ||
    !/<\/html\s*>\s*$/i.test(html)
  )
    throw new Error("Aplus document is oversized or truncated");
  const phone = [...html.matchAll(/<a\b[^>]*>/gi)].some(([tag]) => {
    const href = inventoryHtmlAttribute(tag, "href") ?? "";
    return (
      /^tel:/i.test(href) &&
      ["8597106294", "8594213043"].includes(
        href.replace(/[^\d]/g, "").replace(/^1(?=\d{10}$)/, ""),
      )
    );
  });
  if (
    !phone ||
    !/A Plus Auto LLC/i.test(aplusText(html)) ||
    !aplusText(html).includes("2125 Catnip Hill Rd")
  )
    throw new Error("Aplus native owner or contact identity changed");
  return html;
}
