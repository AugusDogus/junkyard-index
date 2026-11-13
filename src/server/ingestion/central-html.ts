import {
  inventoryHtmlAttribute,
  stripInventoryRawText,
} from "./inventory-html";

export const centralClass = (tag: string, name: string) =>
  (inventoryHtmlAttribute(tag, "class") ?? "").split(/\s+/).includes(name);

export function centralText(raw: string): string {
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

export function centralDivs(html: string, name: string) {
  const blocks: { tag: string; body: string }[] = [];
  let opening: { index: number; end: number; tag: string } | null = null;
  let depth = 0;
  for (const match of html.matchAll(/<\/?div\b[^>]*>/gi)) {
    const tag = match[0];
    if (opening === null) {
      if (!/^<\//.test(tag) && centralClass(tag, name)) {
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
      if (centralClass(tag, name)) throw new Error("Nested Central " + name);
      depth++;
    }
  }
  if (opening !== null) throw new Error("Unclosed Central " + name);
  return blocks;
}

export function centralDocument(raw: string): string {
  const html = stripInventoryRawText(raw);
  if (
    Buffer.byteLength(raw) > 2 * 1024 * 1024 ||
    !/<\/html\s*>\s*$/i.test(html)
  )
    throw new Error("Central document is oversized or truncated");
  const phone = [...html.matchAll(/<a\b[^>]*>/gi)].some(([tag]) =>
    ["9738273696", "9738276457"].includes(
      inventoryHtmlAttribute(tag, "href")?.replace(/[^\d]/g, "") ?? "",
    ),
  );
  if (!phone || !/Central Auto Liquidators/i.test(centralText(html)))
    throw new Error("Central native owner or contact identity changed");
  return html;
}
