import {
  inventoryHtmlAttribute,
  stripInventoryRawText,
} from "./inventory-html";

export const aviationClass = (tag: string, name: string) =>
  (inventoryHtmlAttribute(tag, "class") ?? "").split(/\s+/).includes(name);

export function aviationText(raw: string): string {
  return raw
    .replace(/<[^>]*>/g, " ")
    .replace(
      /&(amp|nbsp|quot|apos|lt|gt|#0*39|#x0*27);/gi,
      (entity, key: string) => {
        switch (key.toLowerCase()) {
          case "amp":
            return "&";
          case "nbsp":
            return " ";
          case "quot":
            return '"';
          case "apos":
          case "#39":
          case "#x27":
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

export function aviationDivs(html: string, name: string) {
  const blocks: { tag: string; body: string }[] = [];
  let opening: { index: number; end: number; tag: string } | null = null;
  let depth = 0;
  for (const match of html.matchAll(/<\/?div\b[^>]*>/gi)) {
    const tag = match[0];
    if (opening === null) {
      if (!/^<\//.test(tag) && aviationClass(tag, name)) {
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
      if (aviationClass(tag, name)) throw new Error("Nested Aviation " + name);
      depth++;
    }
  }
  if (opening !== null) throw new Error("Unclosed Aviation " + name);
  return blocks;
}

export function aviationDocument(raw: string): string {
  const html = stripInventoryRawText(raw);
  if (
    Buffer.byteLength(raw) > 4 * 1024 * 1024 ||
    !/<\/html\s*>\s*$/i.test(html)
  )
    throw new Error("Aviation document is oversized or truncated");
  const phone = [...html.matchAll(/<a\b[^>]*>/gi)].some(
    ([tag]) =>
      inventoryHtmlAttribute(tag, "href")?.replace(/[^\d]/g, "") ===
      "5205741700",
  );
  if (!phone || !/Aviation Auto/i.test(aviationText(html)))
    throw new Error("Aviation native owner or contact identity changed");
  return html;
}
