import {
  inventoryHtmlAttribute,
  stripInventoryRawText,
} from "./inventory-html";

export const chazClass = (tag: string, name: string) =>
  (inventoryHtmlAttribute(tag, "class") ?? "").split(/\s+/).includes(name);

export function chazText(raw: string): string {
  return raw
    .replace(/<[^>]*>/g, " ")
    .replace(
      /&(amp|nbsp|quot|apos|lt|gt|#0*39|#x0*27);/gi,
      (entity, key: string) => {
        if (/^#(?:0*39|x0*27)$/i.test(key)) return "'";
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

export function chazDivs(
  html: string,
  name: string,
  matches: (tag: string) => boolean = (tag) => chazClass(tag, name),
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
      if (matches(tag)) throw new Error("Nested Chaz " + name);
      depth++;
    }
  }
  if (opening !== null) throw new Error("Unclosed Chaz " + name);
  return blocks;
}

export function chazDocument(raw: string): string {
  const html = stripInventoryRawText(raw);
  if (
    Buffer.byteLength(raw) > 2 * 1024 * 1024 ||
    !/<\/html\s*>\s*$/i.test(html)
  )
    throw new Error("Chaz document is oversized or truncated");
  const phone = [...html.matchAll(/<a\b[^>]*>/gi)].some(([tag]) => {
    const href = inventoryHtmlAttribute(tag, "href") ?? "";
    return (
      /^tel:/i.test(href) &&
      ["4108767815", "8882128775"].includes(href.replace(/[^\d]/g, ""))
    );
  });
  if (
    !phone ||
    !/Chaz's Used Auto Parts/i.test(chazText(html)) ||
    !chazText(html).includes("6035 Taneytown Pike")
  )
    throw new Error("Chaz native owner or contact identity changed");
  return html;
}
