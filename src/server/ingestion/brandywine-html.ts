import { createHash } from "node:crypto";
import { z } from "zod";
import {
  inventoryHtmlAttribute,
  stripInventoryRawText,
} from "./inventory-html";
import { BRANDYWINE_ORIGIN } from "./brandywine-yard-metadata";

// Native largest stock page is 46,957 bytes, largest audited detail 31,590.
// The released qualification protocol allowed 512 KiB per logical control.
export const BRANDYWINE_MAX_RESPONSE_BYTES = 512 * 1024;
export const brandywineHash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
export const BrandywineBodySchema = z
  .object({
    bytes: z.number().int().nonnegative().max(BRANDYWINE_MAX_RESPONSE_BYTES),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export const brandywineBody = (html: string) => ({
  bytes: Buffer.byteLength(html),
  sha256: createHash("sha256").update(html).digest("hex"),
});
const wire = z
  .object({
    url: z.string().max(512),
    status: z.union([z.literal(200), z.literal(301)]),
    body: BrandywineBodySchema,
  })
  .strict();
export const BrandywineReceiptSchema = z
  .object({
    requestUrl: z.string().max(512),
    finalUrl: z.string().max(512),
    wires: z.array(wire).min(1).max(2),
  })
  .strict();
export type BrandywineReceipt = z.infer<typeof BrandywineReceiptSchema>;

export function brandywineRoute(value: string) {
  const url = URL.parse(value);
  if (
    !url ||
    url.origin !== BRANDYWINE_ORIGIN ||
    url.username ||
    url.password ||
    url.hash ||
    url.href !== value
  )
    return null;
  const fixed = new Map([
    ["/", "root"],
    ["/veh_manufacturers/", "manufacturers"],
    ["/incoming-vehicles/", "incoming"],
    ["/veh_new/", "fresh"],
  ]);
  if (!url.search) return fixed.get(url.pathname) ?? null;
  const key =
    url.pathname.replace(/\/$/, "") === "/veh_model_list"
      ? "modelinput"
      : url.pathname.replace(/\/$/, "") === "/veh_model_breakdown"
        ? "vehiclename"
        : url.pathname.replace(/\/$/, "") === "/veh_single"
          ? "stockno"
          : null;
  const entries = [...url.searchParams.entries()];
  const label = key ? url.searchParams.get(key) : null;
  if (
    !key ||
    !label ||
    entries.length !== 1 ||
    entries[0]?.[0] !== key ||
    label.length > 100 ||
    [...label].some(
      (character) =>
        character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
    )
  )
    return null;
  if (key === "stockno" && !/^[A-Z0-9]{1,16}$/.test(label)) return null;
  return key === "modelinput"
    ? "models"
    : key === "vehiclename"
      ? "stock"
      : "detail";
}
export function brandywineRedirect(url: string) {
  const parsed = URL.parse(url);
  return parsed &&
    ["/veh_single", "/veh_model_list", "/veh_model_breakdown"].includes(
      parsed.pathname,
    ) &&
    brandywineRoute(url)
    ? BRANDYWINE_ORIGIN + parsed.pathname + "/" + parsed.search
    : null;
}
export function inspectBrandywineReceipt(
  receipt: BrandywineReceipt,
  body: z.infer<typeof BrandywineBodySchema>,
) {
  const first = receipt.wires[0],
    last = receipt.wires.at(-1);
  if (
    !brandywineRoute(receipt.requestUrl) ||
    !first ||
    !last ||
    first.url !== receipt.requestUrl ||
    last.status !== 200 ||
    last.body.bytes === 0 ||
    last.url !== receipt.finalUrl ||
    JSON.stringify(last.body) !== JSON.stringify(body) ||
    (receipt.wires.length === 1
      ? receipt.finalUrl !== receipt.requestUrl
      : first.status !== 301 ||
        receipt.finalUrl !== brandywineRedirect(receipt.requestUrl)) ||
    receipt.wires.reduce((n, w) => n + w.body.bytes, 0) >
      BRANDYWINE_MAX_RESPONSE_BYTES
  )
    throw new Error(
      "Brandywine receipt lost its exact native destination, redirect or complete-body binding",
    );
}
export function brandywineReceipt(
  html: string,
  url: string,
  receipt?: BrandywineReceipt,
) {
  const body = brandywineBody(html);
  const result = receipt ?? {
    requestUrl: url,
    finalUrl: url,
    wires: [{ url, status: 200 as const, body }],
  };
  if (result.requestUrl !== url)
    throw new Error("Brandywine request URL disagrees with its receipt");
  inspectBrandywineReceipt(result, body);
  return result;
}
export function brandywineDecode(raw: string): string {
  const named: Record<string, string> = {
    amp: "&",
    quot: '"',
    apos: "'",
    nbsp: " ",
    lt: "<",
    gt: ">",
    rsquo: "’",
    lsquo: "‘",
    rdquo: "”",
    ldquo: "“",
  };
  return raw.replace(
    /&(#x[\da-f]+|#\d+|[a-z]+);/gi,
    (whole: string, key: string) => {
      if (!key.startsWith("#")) return named[key.toLowerCase()] ?? whole;
      const hex = /^#x/i.test(key),
        point = Number.parseInt(key.slice(hex ? 2 : 1), hex ? 16 : 10);
      return point > 0 &&
        point <= 0x10ffff &&
        !(point >= 0xd800 && point <= 0xdfff)
        ? String.fromCodePoint(point)
        : whole;
    },
  );
}
export const brandywineText = (html: string) =>
  brandywineDecode(html.replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
export const brandywineClass = (tag: string, name: string) =>
  (inventoryHtmlAttribute(tag, "class") ?? "").split(/\s+/).includes(name);
export function brandywineDocument(html: string) {
  const clean = stripInventoryRawText(html);
  if (
    Buffer.byteLength(html) > BRANDYWINE_MAX_RESPONSE_BYTES ||
    !/<\/html\s*>\s*$/i.test(clean) ||
    !/<\/body\s*>/i.test(clean) ||
    /<title\b[^>]*>[^<]*(?:just a moment|access denied|attention required|security check|verify you are human)/i.test(
      clean,
    ) ||
    /\bid=["'](?:challenge-form|cf-challenge|cf-error-details)["']/i.test(clean)
  )
    throw new Error(
      "Brandywine native HTML is incomplete, challenged or exceeds 512 KiB; retain prior inventory and inspect the saved response",
    );
  return clean;
}
/** Preserve exact inspected regions, rejecting malformed or nested boundaries. */
export function brandywineRegions(
  html: string,
  element: string,
  matches: (tag: string) => boolean = () => true,
) {
  const result: { tag: string; body: string; full: string }[] = [];
  let opening: { start: number; end: number; tag: string } | null = null,
    depth = 0;
  for (const match of html.matchAll(
    new RegExp(`<\\/?${element}\\b[^>]*>`, "gi"),
  )) {
    const tag = match[0];
    if (opening === null) {
      if (!/^<\//.test(tag) && matches(tag)) {
        opening = { start: match.index, end: match.index + tag.length, tag };
        depth = 1;
      }
    } else if (/^<\//.test(tag)) {
      if (--depth === 0) {
        result.push({
          tag: opening.tag,
          body: html.slice(opening.end, match.index),
          full: html.slice(opening.start, match.index + tag.length),
        });
        opening = null;
      }
    } else {
      if (matches(tag))
        throw new Error(
          "Brandywine native region unexpectedly nested: " + element,
        );
      depth++;
    }
  }
  if (opening !== null)
    throw new Error("Brandywine native region incomplete: " + element);
  return result;
}
