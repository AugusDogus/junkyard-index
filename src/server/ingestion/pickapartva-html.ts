import { inventoryHtmlAttribute } from "./inventory-html";

export function pickapartvaDecode(raw: string): string {
  const named: Readonly<Record<string, string>> = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    nbsp: " ",
    ndash: "\u2013",
    mdash: "\u2014",
    hellip: "\u2026",
    laquo: "\u00ab",
    raquo: "\u00bb",
    times: "\u00d7",
    copy: "\u00a9",
    rsquo: "\u2019",
    lsquo: "\u2018",
    rdquo: "\u201d",
    ldquo: "\u201c",
  };
  return raw.replace(
    /&(#x[\da-f]+|#\d+|[a-z]+);/gi,
    (entity: string, key: string) => {
      if (!key.startsWith("#")) {
        const value = named[key.toLowerCase()];
        if (value === undefined)
          throw new Error("Unsupported Pick-A-Part VA HTML entity " + entity);
        return value;
      }
      const hex = /^#x/i.test(key);
      const value = Number.parseInt(key.slice(hex ? 2 : 1), hex ? 16 : 10);
      if (value < 1 || value > 0x10ffff || (value >= 0xd800 && value <= 0xdfff))
        throw new Error("Invalid Pick-A-Part VA character reference");
      return String.fromCodePoint(value);
    },
  );
}
export const pickapartvaText = (raw: string) =>
  pickapartvaDecode(raw.replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
export const pickapartvaClass = (tag: string, name: string) =>
  (inventoryHtmlAttribute(tag, "class") ?? "").split(/\s+/).includes(name);

/** Extract balanced source divs instead of repairing truncated card markup. */
export function pickapartvaDivs(html: string, name: string) {
  const found: Array<{ tag: string; body: string }> = [];
  for (const match of html.matchAll(/<div\b[^>]*>/gi)) {
    if (!pickapartvaClass(match[0], name)) continue;
    const start = match.index + match[0].length;
    let depth = 1;
    let end: number | null = null;
    for (const tag of html.slice(start).matchAll(/<\/?div\b[^>]*>/gi)) {
      depth += /^<\//.test(tag[0]) ? -1 : 1;
      if (depth === 0) {
        end = start + tag.index;
        break;
      }
    }
    if (end === null) throw new Error("Truncated Pick-A-Part VA " + name);
    const body = html.slice(start, end);
    if (
      [...body.matchAll(/<div\b[^>]*>/gi)].some(([tag]) =>
        pickapartvaClass(tag, name),
      )
    )
      throw new Error("Nested Pick-A-Part VA " + name);
    found.push({ tag: match[0], body });
  }
  return found;
}
