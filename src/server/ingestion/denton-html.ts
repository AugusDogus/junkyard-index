import {
  inventoryHtmlAttribute,
  stripInventoryRawText,
} from "./inventory-html";

export const DENTON_ORIGIN = "https://dentonauto.com";
export type DentonError = {
  tag: "DentonError";
  operation: string;
  message: string;
};
export const DentonError = {
  create(operation: string, message: string): DentonError {
    return {
      tag: "DentonError",
      operation,
      message: `Denton ${operation}: ${message}. Prior inventory is preserved; inspect the native response before resuming.`,
    };
  },
} as const;
export type DentonResult<T> =
  | { ok: true; value: T }
  | {
      ok: false;
      error: DentonError;
    };
export function dentonBoundary<T>(
  operation: string,
  run: () => T,
): DentonResult<T> {
  try {
    return { ok: true, value: run() };
  } catch (cause) {
    return {
      ok: false,
      error: DentonError.create(
        operation,
        cause instanceof Error ? cause.message : String(cause),
      ),
    };
  }
}
export function dentonText(raw: string) {
  const entities = new Map([
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
      (literal: string, key: string) => {
        if (!key.startsWith("#"))
          return entities.get(key.toLowerCase()) ?? literal;
        const point = Number.parseInt(
          key.slice(/^#x/i.test(key) ? 2 : 1),
          /^#x/i.test(key) ? 16 : 10,
        );
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
export const dentonAttribute = (tag: string, key: string) => {
  const value = inventoryHtmlAttribute(tag, key);
  return value === null ? null : dentonText(value);
};
export const dentonClass = (tag: string, name: string) =>
  (dentonAttribute(tag, "class") ?? "").split(/\s+/).includes(name);

/** Balanced elements reject a truncated native response instead of repairing it. */
export function dentonElements(
  raw: string,
  name: string,
  selected: (tag: string) => boolean = () => true,
) {
  const blocks: { tag: string; body: string }[] = [];
  let opening: { tag: string; end: number } | null = null;
  let depth = 0;
  for (const match of raw.matchAll(new RegExp(`<\\/?${name}\\b[^>]*>`, "gi"))) {
    const tag = match[0];
    if (opening === null) {
      if (!tag.startsWith("</") && selected(tag)) {
        opening = { tag, end: match.index + tag.length };
        depth = 1;
      }
    } else if (tag.startsWith("</")) {
      if (--depth === 0) {
        blocks.push({
          tag: opening.tag,
          body: raw.slice(opening.end, match.index),
        });
        opening = null;
      }
    } else depth++;
  }
  if (opening !== null) throw new Error("Unclosed native " + name + " element");
  return blocks;
}
export function dentonRegion(raw: string, selected: (tag: string) => boolean) {
  const blocks = dentonElements(raw, "div", selected);
  const first = blocks[0];
  if (blocks.length !== 1 || !first)
    throw new Error("Expected one complete native inventory region");
  return first.body;
}
export function dentonDocument(raw: string) {
  const html = stripInventoryRawText(raw);
  const suppliers = [...raw.matchAll(/\bvar\s+urgid\s*=\s*(['"])(.*?)\1\s*;/g)];
  if (
    Buffer.byteLength(raw) > 2 * 1024 * 1024 ||
    [/<html\b/gi, /<body\b/gi, /<\/body\s*>/gi, /<\/html\s*>/gi].some(
      (pattern) => [...html.matchAll(pattern)].length !== 1,
    ) ||
    !/<\/body\s*>\s*<\/html\s*>\s*$/i.test(html) ||
    !suppliers.length ||
    suppliers.some((m) => m[2] !== "KS12")
  )
    throw new Error(
      "Native document is truncated, oversized or has a different supplier",
    );
  return html;
}
export function dentonOwnedUrl(raw: string) {
  const url = URL.parse(raw, DENTON_ORIGIN);
  return url &&
    url.origin === DENTON_ORIGIN &&
    !url.username &&
    !url.password &&
    !url.search &&
    !url.hash
    ? url
    : null;
}
export function dentonTerminal(html: string) {
  for (const [tag] of html.matchAll(
    /<(?:a|button|nav|ul|li|div|input)\b[^>]*>/gi,
  )) {
    if (
      /paginat|page-link|page-numbers|load.?more/i.test(
        dentonAttribute(tag, "class") ?? "",
      ) ||
      /\b(?:next|prev|last)\b/i.test(dentonAttribute(tag, "rel") ?? "") ||
      /[?&](?:page|paged|p|offset|start)=\d+|\/page\/\d+(?:[/?#]|$)/i.test(
        dentonAttribute(tag, "href") ?? "",
      ) ||
      [
        "data-next-page",
        "data-next-url",
        "data-next-cursor",
        "data-aps-page",
      ].some((key) => dentonAttribute(tag, key) !== null)
    )
      throw new Error("Unread native inventory continuation");
  }
  for (const match of html.matchAll(
    /<(?:a|button)\b[^>]*>([\s\S]*?)<\/(?:a|button)>/gi,
  ))
    if (
      /^(?:next(?: page)?|previous(?: page)?|load more|show more)$/i.test(
        dentonText(match[1] ?? ""),
      )
    )
      throw new Error("Unread native inventory continuation");
  for (const match of dentonText(html).matchAll(
    /\b(?:displaying|showing)\s+(\d+)(?:\s*-\s*(\d+))?\s+of\s+(\d+)/gi,
  ))
    if (Number(match[2] ?? match[1]) < Number(match[3]))
      throw new Error("Native inventory is a partial range");
}
