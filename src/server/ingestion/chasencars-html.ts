import { inventoryHtmlAttribute } from "./inventory-html";

export const chasencarsClass = (tag: string, name: string) =>
  (inventoryHtmlAttribute(tag, "class") ?? "").split(/\s+/).includes(name);
export function chasencarsText(raw: string): string {
  const entities = new Map([
    ["amp", "&"],
    ["lt", "<"],
    ["gt", ">"],
    ["quot", '"'],
    ["apos", "'"],
    ["nbsp", " "],
    ["reg", "®"],
    ["copy", "©"],
    ["ndash", "-"],
    ["mdash", "-"],
    ["rsquo", "'"],
    ["hellip", "..."],
  ]);
  return raw
    .replace(/<[^>]*>/g, " ")
    .replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (literal: string, key: string) => {
      if (!key.startsWith("#")) {
        const value = entities.get(key.toLowerCase());
        if (value === undefined)
          throw new Error("Unsupported Chase N Cars entity " + literal);
        return value;
      }
      const hex = /^#x/i.test(key),
        code = Number.parseInt(key.slice(hex ? 2 : 1), hex ? 16 : 10);
      if (code <= 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff))
        throw new Error("Invalid Chase N Cars character reference");
      return String.fromCodePoint(code);
    })
    .replace(/\s+/g, " ")
    .trim();
}
/** Only non-nested inventory elements. Never repair partial source markup. */
export function chasencarsElements(html: string, name: string) {
  const matches = [
    ...html.matchAll(
      new RegExp(`(<${name}\\b[^>]*>)([\\s\\S]*?)<\\/${name}\\s*>`, "gi"),
    ),
  ];
  if (
    matches.length !==
      [...html.matchAll(new RegExp(`<${name}\\b`, "gi"))].length ||
    matches.length !==
      [...html.matchAll(new RegExp(`<\\/${name}\\s*>`, "gi"))].length
  )
    throw new Error("Malformed Chase N Cars " + name + " region");
  return matches.map((match) => ({
    tag: match[1] ?? "",
    body: match[2] ?? "",
  }));
}
