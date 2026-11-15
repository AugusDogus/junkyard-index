import {
  inventoryHtmlAttribute,
  stripInventoryRawText,
} from "./inventory-html";

export const OEM_ORIGIN = "https://oemautorecyclers.com";
export const OEM_ARRIVALS = OEM_ORIGIN + "/latest-arrivals/";
export const OEM_MAKES = OEM_ORIGIN + "/parts/makes/";

export function oemText(raw: string): string {
  return raw
    .replace(/<[^>]*>/g, " ")
    .replace(/&(?:amp|nbsp|quot|apos|lt|gt|#39);/gi, (entity) => {
      switch (entity.toLowerCase()) {
        case "&amp;":
          return "&";
        case "&nbsp;":
          return " ";
        case "&quot;":
          return '"';
        case "&apos;":
        case "&#39;":
          return "'";
        case "&lt;":
          return "<";
        default:
          return ">";
      }
    })
    .replace(/\s+/g, " ")
    .trim();
}
export const oemAttribute = (tag: string, name: string) => {
  const raw = inventoryHtmlAttribute(tag, name);
  return raw === null ? null : oemText(raw);
};
export const oemClass = (tag: string, name: string) =>
  (oemAttribute(tag, "class") ?? "").split(/\s+/).includes(name);

/** Read complete native boundaries without repairing truncated inventory HTML. */
export function oemElements(
  html: string,
  name: string,
  selected: (tag: string) => boolean = () => true,
) {
  const result: { tag: string; body: string }[] = [];
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
        result.push({
          tag: opening.tag,
          body: html.slice(opening.end, match.index),
        });
        opening = null;
      }
    } else {
      if (selected(tag)) throw new Error("Nested OEM inventory boundary");
      depth++;
    }
  }
  if (opening !== null) throw new Error("Unclosed OEM inventory boundary");
  return result;
}
export function oemRegion(html: string, selected: (tag: string) => boolean) {
  const regions = oemElements(html, "div", selected);
  const first = regions[0];
  if (regions.length !== 1 || !first)
    throw new Error("Expected exactly one complete OEM inventory region");
  return first.body;
}
export function oemOwnedUrl(raw: string, base = OEM_ORIGIN): URL | null {
  if (raw.includes("\\") || [...raw].some((c) => c.charCodeAt(0) <= 32))
    return null;
  const url = URL.parse(raw, base);
  return url &&
    url.origin === OEM_ORIGIN &&
    !url.username &&
    !url.password &&
    !url.search &&
    !url.hash
    ? url
    : null;
}
export function oemDocument(raw: string, sourceUrl: string): string {
  const source = oemOwnedUrl(sourceUrl);
  const html = stripInventoryRawText(raw);
  const canonicalTags = [...html.matchAll(/<link\b[^>]*>/gi)].filter(
    ([tag]) => oemAttribute(tag, "rel") === "canonical",
  );
  const canonical = oemOwnedUrl(
    oemAttribute(canonicalTags[0]?.[0] ?? "", "href") ?? "",
  );
  const sellers = [...raw.matchAll(/\bvar\s+urgid\s*=\s*(['"])(.*?)\1\s*;/g)];
  const text = oemText(html);
  // Native IIS virtual routes omit WordPress canonicals. A published canonical,
  // when present, remains an assertion and must agree with the requested route.
  if (
    !source ||
    canonicalTags.length > 1 ||
    (canonicalTags.length === 1 &&
      (!canonical ||
        canonical.pathname.replace(/\/$/, "") !==
          source.pathname.replace(/\/$/, ""))) ||
    Buffer.byteLength(raw) > 4 * 1024 * 1024 ||
    [/<html\b/gi, /<body\b/gi, /<\/body\s*>/gi, /<\/html\s*>/gi].some(
      (pattern) => [...html.matchAll(pattern)].length !== 1,
    ) ||
    !/<\/body\s*>\s*<\/html\s*>\s*$/i.test(html) ||
    !sellers.length ||
    sellers.some((m) => m[2] !== "OH40") ||
    !["OEM Auto Recyclers", "481 Township Road 27", "Bluffton, OH 45817"].every(
      (claim) => text.includes(claim),
    )
  )
    throw new Error(
      "OEM response lost its complete document, OH40 owner, native canonical URL or physical identity",
    );
  return html;
}
export function oemAssertNoContinuation(html: string): void {
  for (const match of html.matchAll(
    /<(a|button)\b([^>]*)>([\s\S]*?)<\/\1\s*>/gi,
  )) {
    const tag = match[2] ?? "";
    if (
      /\b(?:next|prev|last)\b/i.test(oemAttribute(tag, "rel") ?? "") ||
      /^(?:next|previous|load more|show more)(?:\s|$)/i.test(
        oemText(match[3] ?? ""),
      ) ||
      /[?&](?:page|paged|offset|cursor)=/i.test(oemAttribute(tag, "href") ?? "")
    )
      throw new Error(
        "OEM inventory gained an unsupported continuation control; enumeration is incomplete",
      );
  }
  for (const [tag] of html.matchAll(
    /<(?:div|nav|ul|li|button|input)\b[^>]*>/gi,
  )) {
    if (
      /paginat|page-numbers|load.?more/i.test(
        oemAttribute(tag, "class") ?? "",
      ) ||
      ["data-next-page", "data-next-cursor"].some(
        (name) => oemAttribute(tag, name) !== null,
      )
    )
      throw new Error(
        "OEM inventory gained an unsupported pagination boundary; enumeration is incomplete",
      );
  }
}
