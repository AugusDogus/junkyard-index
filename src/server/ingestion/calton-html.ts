import {
  inventoryHtmlAttribute,
  stripInventoryRawText,
} from "./inventory-html";

export const CALTON_ORIGIN = "https://caltonautoparts.com";

export function caltonText(raw: string): string {
  const named = new Map([
    ["amp", "&"],
    ["nbsp", " "],
    ["quot", '"'],
    ["apos", "'"],
    ["lt", "<"],
    ["gt", ">"],
  ]);
  return raw
    .replace(/<[^>]*>/g, " ")
    .replace(
      /&(#x[\da-f]+|#\d+|amp|nbsp|quot|apos|lt|gt);/gi,
      (literal: string, entity: string) => {
        if (!entity.startsWith("#"))
          return named.get(entity.toLowerCase()) ?? literal;
        const hex = /^#x/i.test(entity);
        const point = Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
        return point > 0 &&
          point <= 0x10ffff &&
          !(point >= 0xd800 && point <= 0xdfff)
          ? String.fromCodePoint(point)
          : literal;
      },
    )
    .replace(/\s+/g, " ")
    .trim();
}
export const caltonAttribute = (tag: string, name: string) => {
  const raw = inventoryHtmlAttribute(tag, name);
  return raw === null ? null : caltonText(raw);
};
export const caltonClass = (tag: string, name: string) =>
  (caltonAttribute(tag, "class") ?? "").split(/\s+/).includes(name);

/** Complete native elements only. Never browser-repair an unclosed donor boundary. */
export function caltonElements(
  html: string,
  name: string,
  selected: (tag: string) => boolean = () => true,
) {
  const blocks: { tag: string; body: string }[] = [];
  let opening: { tag: string; end: number } | null = null;
  let depth = 0;
  for (const match of html.matchAll(
    new RegExp(`<\\/?${name}\\b[^>]*>`, "gi"),
  )) {
    const tag = match[0];
    if (opening === null) {
      if (!/^<\//.test(tag) && selected(tag)) {
        opening = { tag, end: match.index + tag.length };
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
      if (selected(tag)) throw new Error("Nested Calton " + name + " boundary");
      depth++;
    }
  }
  if (opening !== null)
    throw new Error("Unclosed Calton " + name + " boundary");
  return blocks;
}
export function caltonRegion(html: string, selected: (tag: string) => boolean) {
  const regions = caltonElements(html, "div", selected);
  const region = regions[0];
  if (regions.length !== 1 || !region)
    throw new Error("Expected one complete Calton inventory region");
  return region.body;
}
export function caltonOwnedUrl(raw: string, base = CALTON_ORIGIN): URL | null {
  if (
    raw.includes("\\") ||
    [...raw].some((character) => character.charCodeAt(0) <= 32)
  )
    return null;
  const url = URL.parse(raw, base);
  return url &&
    url.origin === CALTON_ORIGIN &&
    !url.username &&
    !url.password &&
    !url.search &&
    !url.hash
    ? url
    : null;
}
export function caltonDocument(raw: string, source: URL): string {
  const html = stripInventoryRawText(raw);
  if (
    Buffer.byteLength(raw) > 4 * 1024 * 1024 ||
    [/<html\b/gi, /<body\b/gi, /<\/body\s*>/gi, /<\/html\s*>/gi].some(
      (pattern) => [...html.matchAll(pattern)].length !== 1,
    ) ||
    !/<\/body\s*>\s*<\/html\s*>\s*$/i.test(html)
  )
    throw new Error("Calton document is oversized or truncated");
  const scripts = caltonElements(raw.replace(/<!--[\s\S]*?-->/g, ""), "script");
  const sellers = scripts.flatMap(({ body }) =>
    [...body.matchAll(/\bvar\s+urgid\s*=\s*(['"])(.*?)\1\s*;/g)].map(
      (match) => match[2],
    ),
  );
  const canonicals = [...html.matchAll(/<link\b[^>]*>/gi)].filter(
    ([tag]) => caltonAttribute(tag, "rel") === "canonical",
  );
  const canonical = canonicals[0]?.[0];
  const url = canonical
    ? caltonOwnedUrl(caltonAttribute(canonical, "href") ?? "")
    : null;
  const text = caltonText(html);
  if (
    !sellers.length ||
    sellers.some((seller) => seller !== "MM28") ||
    !["Calton Auto Parts Recyclers", "7491 Washington Blvd", "21075"].every(
      (claim) => text.includes(claim),
    ) ||
    canonicals.length !== 1 ||
    !url ||
    url.pathname.replace(/\/$/, "") !== source.pathname.replace(/\/$/, "")
  )
    throw new Error(
      "Calton MM28 owner, physical identity or canonical source is missing or conflicting",
    );
  return html;
}
export function caltonContinuations(html: string): string[] {
  const controls: string[] = [];
  for (const match of html.matchAll(
    /<(a|button)\b([^>]*)>([\s\S]*?)<\/\1\s*>/gi,
  )) {
    const tag = match[2] ?? "";
    // These observed button targets change photographs, not inventory pages.
    if (
      match[1]?.toLowerCase() === "button" &&
      caltonClass(tag, "aps-gallery-carousel-control") &&
      ["#apsPartsGalleryCarousel", "#apsLaGalleryCarousel"].includes(
        caltonAttribute(tag, "data-bs-target") ?? "",
      ) &&
      ["next", "prev"].includes(caltonAttribute(tag, "data-bs-slide") ?? "") &&
      caltonAttribute(tag, "rel") === null &&
      caltonAttribute(tag, "href") === null &&
      caltonAttribute(tag, "data-next-page") === null &&
      caltonAttribute(tag, "data-next-cursor") === null
    )
      continue;
    if (
      /\b(?:next|prev|last)\b/i.test(caltonAttribute(tag, "rel") ?? "") ||
      /^(?:next|previous|load more|show more)(?:\s|$)/i.test(
        caltonText(match[3] ?? ""),
      ) ||
      /[?&](?:page|paged|offset|cursor)=/i.test(
        caltonAttribute(tag, "href") ?? "",
      )
    )
      controls.push(match[0]);
  }
  for (const [tag] of html.matchAll(
    /<(?:div|nav|ul|li|button|input)\b[^>]*>/gi,
  ))
    if (
      (/paginat|page-numbers|load.?more/i.test(
        caltonAttribute(tag, "class") ?? "",
      ) &&
        !(
          caltonClass(tag, "elementor-widget-slides") &&
          caltonAttribute(tag, "data-widget_type") === "slides.default"
        )) ||
      ["data-next-page", "data-next-cursor"].some(
        (name) => caltonAttribute(tag, name) !== null,
      )
    )
      controls.push(tag);
  return controls;
}
