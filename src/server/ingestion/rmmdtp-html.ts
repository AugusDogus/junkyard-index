import { inventoryHtmlAttribute } from "./inventory-html";

export const RMMDTP_ORIGIN = "https://rmmdtp.com";
export const RMMDTP_INVENTORY = RMMDTP_ORIGIN + "/trucks/";
export const RMMDTP_MAX_BODY_BYTES = 2 * 1024 * 1024;
export function rmmdtpText(raw: string): string {
  return raw
    .replace(/<[^>]*>/g, " ")
    .replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (entity: string, key: string) => {
      const named: Readonly<Record<string, string>> = {
        amp: "&",
        lt: "<",
        gt: ">",
        quot: '"',
        apos: "'",
        nbsp: " ",
        ndash: "–",
        mdash: "\u2014",
        copy: "©",
      };
      if (!key.startsWith("#")) {
        const value = named[key.toLowerCase()];
        if (value === undefined)
          throw new Error("Unsupported native HTML entity " + entity);
        return value;
      }
      const hex = /^#x/i.test(key);
      const point = Number.parseInt(key.slice(hex ? 2 : 1), hex ? 16 : 10);
      if (
        point <= 0 ||
        point > 0x10ffff ||
        (point >= 0xd800 && point <= 0xdfff)
      )
        throw new Error("Invalid native character reference");
      return String.fromCodePoint(point);
    })
    .replace(/\s+/g, " ")
    .trim();
}
export const rmmdtpAttribute = (tag: string, name: string) => {
  const value = inventoryHtmlAttribute(tag, name);
  return value === null ? null : rmmdtpText(value);
};
export const rmmdtpHasClass = (tag: string, name: string) =>
  (rmmdtpAttribute(tag, "class") ?? "").split(/\s+/).includes(name);

/** Balanced native divs fail closed on truncation instead of repairing HTML. */
export function rmmdtpDivs(
  html: string,
  matches: (tag: string) => boolean,
): string[] {
  const blocks: string[] = [];
  let start: number | null = null,
    depth = 0;
  for (const match of html.matchAll(/<\/?div\b[^>]*>/gi)) {
    const tag = match[0],
      closing = /^<\//.test(tag);
    if (start === null) {
      if (!closing && matches(tag)) {
        start = match.index;
        depth = 1;
      }
    } else if (closing) {
      if (--depth === 0) {
        blocks.push(html.slice(start, match.index + tag.length));
        start = null;
      }
    } else {
      if (matches(tag)) throw new Error("Nested native inventory block");
      depth++;
    }
  }
  if (start !== null) throw new Error("Unclosed native inventory block");
  return blocks;
}
export function rmmdtpPageUrl(raw: string, page: number): string | null {
  const url = URL.parse(raw, RMMDTP_ORIGIN);
  if (
    !url ||
    url.origin !== RMMDTP_ORIGIN ||
    url.pathname !== "/trucks/" ||
    url.username ||
    url.password ||
    url.hash
  )
    return null;
  if (page === 1) return url.search === "" ? url.href : null;
  return url.search === `?page_number=${page}` && page >= 2 && page <= 400
    ? url.href
    : null;
}
export function rmmdtpDetailUrl(raw: string): string | null {
  const url = URL.parse(raw, RMMDTP_ORIGIN);
  return url &&
    url.origin === RMMDTP_ORIGIN &&
    !url.username &&
    !url.password &&
    !url.hash &&
    url.pathname === "/truck-description/" &&
    /^\?truck=[1-9]\d{0,11}$/.test(url.search)
    ? url.href
    : null;
}
