import {
  inventoryHtmlAttribute,
  stripInventoryRawText,
} from "./inventory-html";
import { SIX03_CATALOG, SIX03_ORIGIN } from "./six03-yard-metadata";

export const six03Class = (tag: string, name: string) =>
  (inventoryHtmlAttribute(tag, "class") ?? "").split(/\s+/).includes(name);

export function six03Text(raw: string): string {
  return raw
    .replace(/<[^>]*>/g, " ")
    .replace(
      /&(?:#(x[0-9a-f]+|\d+)|(amp|nbsp|quot|apos|lt|gt|middot|hellip|times|ndash|mdash|rarr));/gi,
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
        const entities: Record<string, string> = {
          amp: "&",
          nbsp: " ",
          quot: '"',
          apos: "'",
          lt: "<",
          gt: ">",
          middot: "·",
          hellip: "…",
          times: "×",
          ndash: "–",
          mdash: String.fromCharCode(8212),
          rarr: "→",
        };
        return entities[key?.toLowerCase() ?? ""] ?? entity;
      },
    )
    .replace(/\s+/g, " ")
    .trim();
}

/** Balance only the named div region, without browser HTML repair. */
export function six03Divs(html: string, predicate: (tag: string) => boolean) {
  const blocks: { tag: string; body: string }[] = [];
  let opening: { end: number; tag: string } | null = null;
  let depth = 0;
  for (const match of html.matchAll(/<\/?div\b[^>]*>/gi)) {
    const tag = match[0];
    if (opening === null) {
      if (!/^<\//.test(tag) && predicate(tag)) {
        opening = { end: match.index + tag.length, tag };
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
      if (predicate(tag)) throw new Error("Nested 603 native region");
      depth++;
    }
  }
  if (opening !== null) throw new Error("Unclosed 603 native region");
  return blocks;
}

export function six03Document(raw: string, canonical: string): string {
  const html = stripInventoryRawText(raw);
  if (
    Buffer.byteLength(raw) > 2 * 1024 * 1024 ||
    !/<\/html\s*>\s*$/i.test(html)
  )
    throw new Error("603 native document exceeds 2 MiB or is truncated");
  const urls = [...html.matchAll(/<link\b[^>]*>/gi)]
    .filter(([tag]) => inventoryHtmlAttribute(tag, "rel") === "canonical")
    .map(([tag]) => six03Text(inventoryHtmlAttribute(tag, "href") ?? ""));
  const phone = [...html.matchAll(/<a\b[^>]*>/gi)].some(
    ([tag]) =>
      /^tel:/i.test(inventoryHtmlAttribute(tag, "href") ?? "") &&
      (inventoryHtmlAttribute(tag, "href") ?? "").replace(/\D/g, "") ===
        "6033927313",
  );
  if (
    urls.length !== 1 ||
    urls[0] !== canonical ||
    !phone ||
    !six03Text(html).includes("603 Auto Salvage")
  )
    throw new Error("603 canonical destination, owner or phone changed");
  return html;
}

/** The inspected catalog replaces its main, including exactly one native
 * WordPress page-two anchor. Its matching head link is the same discarded
 * graph. Every other continuation needs a new complete traversal contract. */
export function six03Continuations(
  html: string,
  displacedMain: string | null,
): void {
  const known = SIX03_CATALOG + "page/2/";
  let headLinks = 0;
  let displacedLinks = 0;
  let localButtons = 0;
  let displacedPagination = 0;
  for (const match of html.matchAll(/(<nav\b[^>]*>)([\s\S]*?)<\/nav\s*>/gi)) {
    if (!/paginat/i.test(inventoryHtmlAttribute(match[1] ?? "", "class") ?? ""))
      continue;
    if (
      displacedMain !== null &&
      displacedMain.includes(match[0]) &&
      six03Text(match[2] ?? "") === "Next →" &&
      (match[2] ?? "").includes('href="' + known + '"')
    )
      displacedPagination++;
    else
      throw new Error(
        "603 unclassified pagination container changed the finite donor graph",
      );
  }
  for (const [tag] of html.matchAll(/<link\b[^>]*>/gi)) {
    const rel = (inventoryHtmlAttribute(tag, "rel") ?? "")
      .toLowerCase()
      .split(/\s+/);
    if (!rel.some((value) => value === "next" || value === "prev")) continue;
    if (
      displacedMain !== null &&
      rel.length === 1 &&
      rel[0] === "next" &&
      six03Text(inventoryHtmlAttribute(tag, "href") ?? "") === known
    )
      headLinks++;
    else
      throw new Error(
        "603 unclassified head continuation changed the native graph",
      );
  }
  for (const match of html.matchAll(
    /(<(?:a|button)\b[^>]*>)([\s\S]*?)<\/(?:a|button)\s*>/gi,
  )) {
    const tag = match[1] ?? "";
    const href = six03Text(inventoryHtmlAttribute(tag, "href") ?? "");
    const url = URL.parse(href, SIX03_ORIGIN);
    const label = six03Text(match[2] ?? "");
    if (
      displacedMain !== null &&
      inventoryHtmlAttribute(tag, "id") === "pv-load-btn" &&
      inventoryHtmlAttribute(tag, "onclick") === "pvLoadMore()"
    ) {
      localButtons++;
      continue;
    }
    if (
      displacedMain !== null &&
      href === known &&
      displacedMain.includes(match[0]) &&
      /^Next\s+→$/.test(six03Text(match[2] ?? ""))
    ) {
      displacedLinks++;
      continue;
    }
    const rel = (inventoryHtmlAttribute(tag, "rel") ?? "").split(/\s+/);
    const remote =
      url !== null &&
      ([...url.searchParams.keys()].some((key) =>
        /^(?:page|paged|batch|offset|cursor|start|limit|pagination|loadmore)$/i.test(
          key,
        ),
      ) ||
        (url.search !== "" && /^\d+$/.test(label)));
    if (
      remote ||
      rel.some((value) => /^(?:next|prev)$/i.test(value)) ||
      /^(?:next|previous|prev|load more|see more|older|newer)\b/i.test(label) ||
      /\bdata-(?:cursor|page|paged|offset|batch|slice|next|continuation|more|load)[\s=]/i.test(
        tag,
      ) ||
      /paginat|page-link|load.?more/i.test(
        inventoryHtmlAttribute(tag, "class") ?? "",
      ) ||
      (url?.origin === SIX03_ORIGIN &&
        /^\/parts-vehicles\/page\//.test(url.pathname))
    )
      throw new Error(
        "603 unclassified native continuation changed the finite donor graph",
      );
  }
  if (
    displacedMain !== null &&
    (headLinks !== 1 ||
      displacedLinks !== 1 ||
      displacedPagination !== 1 ||
      localButtons !== 1)
  )
    throw new Error("603 displaced WordPress continuation boundary changed");
}
