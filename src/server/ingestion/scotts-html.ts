import {
  inventoryHtmlAttribute,
  stripInventoryRawText,
} from "./inventory-html";

export const scottsClass = (tag: string, name: string) =>
  (inventoryHtmlAttribute(tag, "class") ?? "").split(/\s+/).includes(name);

export function scottsText(raw: string): string {
  return raw
    .replace(/<[^>]*>/g, " ")
    .replace(
      /&(?:#(x[0-9a-f]+|\d+)|(amp|nbsp|quot|apos|lt|gt));/gi,
      (
        entity: string,
        numeric: string | undefined,
        key: string | undefined,
      ) => {
        if (numeric) {
          const value =
            numeric[0]?.toLowerCase() === "x"
              ? Number.parseInt(numeric.slice(1), 16)
              : Number(numeric);
          return value > 0 &&
            value <= 0x10ffff &&
            !(value >= 0xd800 && value <= 0xdfff)
            ? String.fromCodePoint(value)
            : entity;
        }
        switch (key?.toLowerCase()) {
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

export function scottsDivs(html: string, name: string) {
  const blocks: { tag: string; body: string }[] = [];
  let opening: { index: number; end: number; tag: string } | null = null;
  let depth = 0;
  for (const match of html.matchAll(/<\/?div\b[^>]*>/gi)) {
    const tag = match[0];
    if (opening === null) {
      if (!/^<\//.test(tag) && scottsClass(tag, name)) {
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
      if (scottsClass(tag, name)) throw new Error("Nested Scotts " + name);
      depth++;
    }
  }
  if (opening !== null) throw new Error("Unclosed Scotts " + name);
  return blocks;
}

export function scottsDocument(raw: string): string {
  const html = stripInventoryRawText(raw);
  if (
    Buffer.byteLength(raw) > 2 * 1024 * 1024 ||
    !/<\/html\s*>\s*$/i.test(html)
  )
    throw new Error("Scotts document is oversized or truncated");
  const phone = [...html.matchAll(/<a\b[^>]*>/gi)].some(([tag]) =>
    ["9704980662"].includes(
      inventoryHtmlAttribute(tag, "href")
        ?.replace(/%20/g, " ")
        .replace(/[^\d]/g, "") ?? "",
    ),
  );
  const text = scottsText(html);
  if (
    !phone ||
    !/Scott['’]s Used Parts/i.test(text) ||
    !text.includes("938 West Willox Lane") ||
    !text.includes("Fort Collins") ||
    !text.includes("80524")
  )
    throw new Error("Scotts native owner or contact identity changed");
  return html;
}
