import {
  inventoryHtmlAttribute,
  stripInventoryRawText,
} from "./inventory-html";
import { MEEKS_ORIGIN } from "./meeks-yard-metadata";

const entities = new Map([
  ["amp", "&"],
  ["lt", "<"],
  ["gt", ">"],
  ["quot", '"'],
  ["apos", "'"],
  ["nbsp", " "],
]);

export function meeksText(raw: string, optional = false): string {
  let valid = true;
  const value = raw
    .replace(/<[^>]*>/g, " ")
    .replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (_entity: string, key: string) => {
      if (!key.startsWith("#")) {
        const decoded = entities.get(key.toLowerCase());
        if (decoded === undefined) valid = false;
        return decoded ?? "";
      }
      const hex = /^#x/i.test(key);
      const point = Number.parseInt(key.slice(hex ? 2 : 1), hex ? 16 : 10);
      if (
        point <= 0 ||
        point > 0x10ffff ||
        (point >= 0xd800 && point <= 0xdfff)
      ) {
        valid = false;
        return "";
      }
      return String.fromCodePoint(point);
    })
    .trim();
  if (valid && value.length <= 300) return value;
  if (optional) return "";
  throw new Error(
    "Meeks required cell has an unsupported character reference or exceeds 300 characters; inspect the saved row before continuing",
  );
}

export function meeksDocument(raw: string, canonical: string): string {
  const html = stripInventoryRawText(raw);
  if (Buffer.byteLength(raw) > 2 * 1024 * 1024 || !/<\/html>\s*$/i.test(html))
    throw new Error(
      "Meeks document is oversized or incomplete; preserve prior inventory and inspect the response",
    );
  const links = [...html.matchAll(/<link\b[^>]*>/gi)].filter(
    ([tag]) => inventoryHtmlAttribute(tag, "rel") === "canonical",
  );
  if (
    links.length !== 1 ||
    inventoryHtmlAttribute(links[0]?.[0] ?? "", "href") !== canonical
  )
    throw new Error(
      "Meeks canonical destination changed or is filtered; inspect the native page before reconciling",
    );
  return html;
}

export function meeksImageUrl(raw: string | null): string | null {
  const url = raw === null ? null : URL.parse(raw, MEEKS_ORIGIN);
  return url?.origin === MEEKS_ORIGIN &&
    !url.username &&
    !url.password &&
    !url.search &&
    !url.hash &&
    /^\/vehicle_photos\/[a-z0-9_-]+\.(?:jpe?g|png|webp)$/i.test(url.pathname)
    ? url.href
    : null;
}
