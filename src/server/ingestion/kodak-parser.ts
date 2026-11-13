import { createHash } from "node:crypto";
import { z } from "zod";
import {
  inventoryHtmlAttribute,
  stripInventoryRawText,
} from "./inventory-html";
import {
  KODAK_HOME,
  KODAK_INVENTORY,
  KODAK_ORIGIN,
} from "./kodak-yard-metadata";

export const KODAK_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
export const KODAK_MAX_DONORS = 200;
export interface KodakRecord {
  item: string;
  title: string;
  fields: Record<string, string>;
  photo: string | null;
  printedIdentifier: string | null;
}
export const KodakOwnershipSchema = z
  .object({
    bodyHash: z.string().regex(/^[a-f0-9]{64}$/),
    bytes: z.number().int().positive().max(KODAK_MAX_RESPONSE_BYTES),
    inventoryUrl: z.literal(KODAK_INVENTORY),
  })
  .strict();
export type KodakOwnership = z.infer<typeof KodakOwnershipSchema>;

function text(
  raw: string,
  malformed: "reject" | "preserve" = "reject",
): string {
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
    .replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (literal: string, key: string) => {
      if (!key.startsWith("#")) {
        const value = entities.get(key.toLowerCase());
        if (value === undefined) {
          if (malformed === "preserve") return literal;
          throw new Error("Unsupported Kodak HTML entity " + literal);
        }
        return value;
      }
      const hex = /^#x/i.test(key);
      const code = Number.parseInt(key.slice(hex ? 2 : 1), hex ? 16 : 10);
      if (code <= 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) {
        if (malformed === "preserve") return literal;
        throw new Error("Invalid Kodak HTML character reference");
      }
      return String.fromCodePoint(code);
    })
    .replace(/\s+/g, " ")
    .trim();
}

const containsEncodedText = (value: string) =>
  /&(?:#[^;\s]*|[a-z]+);/i.test(value);
function optionalText(raw: string): string | null {
  const value = text(raw, "preserve");
  return value && !containsEncodedText(value) ? value : null;
}

function document(raw: string, expectedUrl: string): string {
  if (
    Buffer.byteLength(raw) > KODAK_MAX_RESPONSE_BYTES ||
    !/<\/html\s*>\s*$/i.test(raw)
  )
    throw new Error("Kodak document exceeds 2 MiB or is truncated");
  if (
    /<title>\s*(?:just a moment|access denied)|cf-chl-|challenge-platform/i.test(
      raw,
    )
  )
    throw new Error(
      "Kodak returned an access challenge; preserve the previous checkpoint",
    );
  const html = stripInventoryRawText(raw);
  const canonicals = [...html.matchAll(/<link\b[^>]*>/gi)].filter((match) =>
    inventoryHtmlAttribute(match[0], "rel")?.split(/\s+/).includes("canonical"),
  );
  if (
    canonicals.length !== 1 ||
    inventoryHtmlAttribute(canonicals[0]?.[0] ?? "", "href") !== expectedUrl ||
    !text(html, "preserve").includes("Kodak Auto Inc") ||
    !/<a\b[^>]*href=["']tel:8654012898["']/i.test(html)
  )
    throw new Error(
      "Kodak canonical URL, provider name or native phone changed",
    );
  if (
    [...html.matchAll(/<link\b[^>]*>/gi)].some((match) =>
      inventoryHtmlAttribute(match[0], "rel")
        ?.toLowerCase()
        .split(/\s+/)
        .some((rel) => rel === "next" || rel === "last"),
    )
  )
    throw new Error(
      "Kodak published an unread continuation link; inspect the complete graph before resuming",
    );
  for (const match of html.matchAll(
    /<(a|button)\b([^>]*)>([\s\S]*?)<\/\1\s*>/gi,
  )) {
    const tag = match[2] ?? "";
    const label = text(match[3] ?? "", "preserve");
    const href = inventoryHtmlAttribute(tag, "href");
    const url = href === null ? null : URL.parse(text(href), expectedUrl);
    const rel =
      inventoryHtmlAttribute(tag, "rel")?.toLowerCase().split(/\s+/) ?? [];
    const continuation =
      rel.some((value) => value === "next" || value === "last") ||
      /^(?:next|previous|last|load more|show more)(?: page)?$/i.test(label) ||
      (url !== null &&
        [...url.searchParams.keys()].some((name) =>
          /^(?:page|paged|pagenum|offset|cursor)$/i.test(name),
        ));
    const inventoryLink = /inventor|arrival|pull-a-part|vehicle/i.test(
      (href ?? "") + " " + label,
    );
    if (continuation || (inventoryLink && url?.href !== KODAK_INVENTORY))
      throw new Error(
        "Kodak published an unread donor or continuation control; inspect the complete graph before resuming",
      );
  }
  if (/<iframe\b/i.test(html))
    throw new Error(
      "Kodak gained an embedded inventory surface; inspect ownership and enumeration",
    );
  return html;
}

export function parseKodakOwnership(raw: string): KodakOwnership {
  const html = document(raw, KODAK_HOME);
  const plain = text(html, "preserve");
  if (
    ![
      "647 Asheville Hwy",
      "Strawberry Plains",
      "37871",
      "parts stripped from our Salvage lot.",
      "full service salvage yard",
      "Pick and Pay here.",
    ].every((claim) => plain.includes(claim))
  )
    throw new Error(
      "Kodak native physical yard or own-salvage inventory assertion changed",
    );
  if (/\bVIN\s*:|MENU_SECTION\d+_ITEM\d+_TITLE/i.test(html))
    throw new Error(
      "Kodak root gained donor or arrival records outside the inspected inventory roster",
    );
  const links = [...html.matchAll(/<a\b[^>]*>/gi)].map((match) =>
    inventoryHtmlAttribute(match[0], "href"),
  );
  if (
    !links.some(
      (href) =>
        href !== null &&
        URL.parse(text(href), KODAK_ORIGIN)?.href === KODAK_INVENTORY,
    )
  )
    throw new Error("Kodak root no longer links the inspected donor inventory");
  return KodakOwnershipSchema.parse({
    bodyHash: createHash("sha256").update(raw).digest("hex"),
    bytes: Buffer.byteLength(raw),
    inventoryUrl: KODAK_INVENTORY,
  });
}

/** Exact GoDaddy field IDs bind each title and description. Layout make headings
 * never replace a native donor title. Missing optional fields remain nullable.
 */
export function parseKodakInventory(raw: string): KodakRecord[] {
  const html = document(raw, KODAK_INVENTORY);
  if (/<form\b/i.test(html))
    throw new Error(
      "Kodak inventory gained a form outside its inspected finite roster",
    );
  const headings = [
    ...html.matchAll(
      /<h2\b[^>]*data-aid=["']MENU_SECTION_TITLE_RENDERED["'][^>]*>([\s\S]*?)<\/h2>/gi,
    ),
  ];
  if (
    headings.length !== 1 ||
    text(headings[0]?.[1] ?? "") !== "Inventory List"
  )
    throw new Error("Kodak native Inventory List scope changed");
  const groups = new Map<string, Map<string, string>>();
  const matched = new Set<string>();
  for (const match of html.matchAll(
    /<([a-z][\w-]*)\b[^>]*\bdata-aid=["'](MENU_SECTION\d+_ITEM\d+_(TITLE|DESC|PRICE|IMAGE))["'][^>]*>/gi,
  )) {
    const aid = match[2] ?? "";
    if (matched.has(aid))
      throw new Error("Kodak donor field ID is duplicated: " + aid);
    matched.add(aid);
    const suffix = match[3] ?? "";
    const item = aid.slice(0, -(suffix.length + 1));
    const tagName = match[1] ?? "";
    const after = html.slice(match.index + match[0].length);
    const end = new RegExp(`</${tagName}\\s*>`, "i").exec(after);
    if (suffix !== "IMAGE" && !end)
      throw new Error("Kodak donor field is unclosed: " + aid);
    const content =
      suffix === "IMAGE" ? match[0] : after.slice(0, end?.index ?? 0);
    if (suffix === "TITLE" && /<\/?(?:h[1-6]|div|img|p)\b/i.test(content))
      throw new Error(
        "Kodak donor title is incomplete or crosses another card field",
      );
    if (suffix === "DESC" && /<div\b/i.test(content))
      throw new Error("Kodak donor description grammar changed");
    const group = groups.get(item) ?? new Map<string, string>();
    group.set(suffix, content);
    groups.set(item, group);
  }
  if (!groups.size || groups.size > KODAK_MAX_DONORS)
    throw new Error("Kodak native donor roster is empty or exceeds 200 cards");
  const records: KodakRecord[] = [];
  let vinLabels = 0;
  for (const [item, group] of groups) {
    if (!group.has("TITLE") && !group.has("DESC"))
      throw new Error("Kodak has an orphan optional donor field: " + item);
    const fields: Record<string, string> = {};
    const seenLabels = new Set<string>();
    const description = group.get("DESC") ?? "";
    for (const match of description.matchAll(
      /<p\b[^>]*>([\s\S]*?)<\/p\s*>/gi,
    )) {
      const line = text(match[1] ?? "", "preserve");
      if (!line) continue;
      const colon = line.indexOf(":");
      const label = line.slice(0, colon).trim();
      if (
        colon < 1 ||
        containsEncodedText(label) ||
        (label === "VIN" && seenLabels.has(label))
      )
        throw new Error(
          "Kodak native description has ambiguous labelled fields",
        );
      const value = line.slice(colon + 1).trim();
      if (label === "VIN") {
        if (containsEncodedText(value))
          throw new Error("Kodak VIN contains undecodable native text");
        fields[label] = value;
        vinLabels++;
      } else if (seenLabels.has(label)) {
        // Optional disagreements affect only that field, never donor identity.
        delete fields[label];
      } else if (!containsEncodedText(value)) fields[label] = value;
      seenLabels.add(label);
    }
    const image = group.get("IMAGE");
    records.push({
      item,
      title: text(group.get("TITLE") ?? ""),
      fields,
      photo:
        image === undefined
          ? null
          : inventoryHtmlAttribute(image, "data-srclazy"),
      printedIdentifier: optionalText(group.get("PRICE") ?? ""),
    });
  }
  if ([...text(html, "preserve").matchAll(/\bVIN\s*:/gi)].length !== vinLabels)
    throw new Error(
      "Kodak VIN text appears outside complete native donor descriptions",
    );
  return records;
}
