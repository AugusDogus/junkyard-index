import { createHash } from "node:crypto";
import { z } from "zod";
import { stripInventoryRawText } from "./inventory-html";
import {
  prattAttribute,
  prattClass,
  prattElements,
  prattRegion,
  prattText,
} from "./pratt-html";
import {
  OEMGARAGE_MAX_BYTES,
  OEMGARAGE_ORIGIN,
  OEMGARAGE_YARD,
} from "./oemgarage-yard-metadata";

export const oemgarageHash = (value: unknown): string =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
export function oemgarageDonorId(raw: string): string | null {
  const u = URL.parse(raw, OEMGARAGE_ORIGIN);
  return u &&
    u.origin === OEMGARAGE_ORIGIN &&
    !u.username &&
    !u.password &&
    !u.search &&
    !u.hash
    ? (/^\/collections\/donor-([1-9]\d{0,6})$/.exec(u.pathname)?.[1] ?? null)
    : null;
}
export const OemgarageCardSchema = z
  .object({
    id: z.string().regex(/^[1-9]\d{0,6}$/),
    url: z.string().max(1000),
    title: z.string().max(300),
    chassis: z.string().max(100),
  })
  .strict()
  .superRefine((v, c) => {
    if (v.url !== OEMGARAGE_ORIGIN + "/collections/donor-" + v.id)
      c.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Foreign or mismatched oeM Garage donor join",
      });
  });
export type OemgarageCard = z.infer<typeof OemgarageCardSchema>;
export const OemgarageCatalogSchema = z
  .object({ cards: z.array(OemgarageCardSchema).min(1).max(1000) })
  .strict();
export type OemgarageCatalog = z.infer<typeof OemgarageCatalogSchema>;
export const OemgarageRecordSchema = z
  .object({
    card: OemgarageCardSchema,
    title: z.string().max(300),
    header: z.string().max(300),
    stock: z.string().max(100),
    partsCount: z.number().int().min(0).max(100000),
    fields: z.record(z.string().max(100), z.string().max(500)),
    imageUrl: z.string().max(3000).nullable(),
  })
  .strict();
export type OemgarageRecord = z.infer<typeof OemgarageRecordSchema>;

function document(raw: string): string {
  const html = stripInventoryRawText(raw);
  if (
    Buffer.byteLength(raw) > OEMGARAGE_MAX_BYTES ||
    [/<html\b/gi, /<body\b/gi, /<\/body\s*>/gi, /<\/html\s*>/gi].some(
      (p) => [...html.matchAll(p)].length !== 1,
    ) ||
    !/<\/body\s*>\s*<\/html\s*>\s*$/i.test(html) ||
    /access denied|checking your browser|just a moment|request rejected|unusual traffic/i.test(
      prattText(html),
    )
  )
    throw new Error(
      "oeM Garage response is incomplete, oversized or contains access-control content",
    );
  const footer = prattElements(html, "footer");
  if (
    footer.length !== 1 ||
    ![
      "5808 Dawson Street, Hollywood FL 33023",
      "Sales@oe-mgarage.com",
      "954-882-3346",
    ].every((v) => prattText(footer[0]?.body ?? "").includes(v))
  )
    throw new Error("oeM Garage native physical owner/address/contact changed");
  return html;
}
export function parseOemgarageOwner(raw: string): string {
  const html = document(raw);
  if (
    !prattElements(html, "a").some(
      (a) =>
        prattAttribute(a.tag, "href") === "/collections/vehicles-dismantled" &&
        prattText(a.body) === "Vehicles Dismantled",
    )
  )
    throw new Error("oeM Garage owner no longer publishes its donor inventory");
  return oemgarageHash(OEMGARAGE_YARD);
}
export function parseOemgarageCatalog(raw: string): OemgarageCatalog {
  const html = document(raw);
  const filterStart = raw.indexOf(
    "var root = document.getElementById('DonorGrid-",
  );
  const filterEnd = raw.indexOf(
    "search.addEventListener('input', apply)",
    filterStart,
  );
  const lists = prattElements(html, "ul", (tag) =>
    (prattAttribute(tag, "id") ?? "").startsWith("DonorList-"),
  );
  const list = lists[0];
  if (
    !list ||
    lists.length !== 1 ||
    !prattText(html).includes("The vehicles we've parted out!") ||
    !raw.includes("var total = items.length;") ||
    !raw.includes("root.querySelectorAll('#DonorList-") ||
    filterStart < 0 ||
    filterEnd <= filterStart ||
    /\b(?:fetch|XMLHttpRequest)\s*\(/.test(raw.slice(filterStart, filterEnd))
  )
    throw new Error(
      "oeM Garage complete finite donor grid or client-only filtering changed",
    );
  if (
    prattElements(list.body, "a").some((a) =>
      /[?&](?:page|cursor|offset)=/.test(prattAttribute(a.tag, "href") ?? ""),
    )
  )
    throw new Error("oeM Garage donor grid has an unenumerated continuation");
  const rows = prattElements(list.body, "li");
  if (rows.length !== [...list.body.matchAll(/<li\b/gi)].length)
    throw new Error(
      "oeM Garage donor grid contains nested or incomplete cards",
    );
  const cards = rows.map((row) => {
    if (!prattClass(row.tag, "collection-list__item"))
      throw new Error("Unrecognized oeM Garage donor card");
    const links = prattElements(row.body, "a");
    const headings = prattElements(row.body, "h3");
    const titles = headings.map((h) => prattText(h.body));
    const urls = links.map(
      (a) =>
        URL.parse(prattAttribute(a.tag, "href") ?? "", OEMGARAGE_ORIGIN)
          ?.href ?? "",
    );
    const url = urls[0] ?? "",
      id = oemgarageDonorId(url),
      title = titles[0] ?? "";
    if (
      !id ||
      links.length !== 2 ||
      new Set(urls).size !== 1 ||
      titles.length !== 2 ||
      new Set(titles).size !== 1 ||
      (prattAttribute(row.tag, "data-title") ?? "") !== title.toLowerCase()
    )
      throw new Error(
        "oeM Garage donor link, duplicate card face or title binding changed",
      );
    return OemgarageCardSchema.parse({
      id,
      url,
      title,
      chassis: prattAttribute(row.tag, "data-chassis") ?? "",
    });
  });
  const allDonorLinks = prattElements(html, "a").filter(
    (a) => oemgarageDonorId(prattAttribute(a.tag, "href") ?? "") !== null,
  );
  if (
    new Set(cards.map((c) => c.id)).size !== cards.length ||
    allDonorLinks.length !== cards.length * 2
  )
    throw new Error(
      "oeM Garage donor enumeration has duplicate IDs or donors outside the finite grid",
    );
  return OemgarageCatalogSchema.parse({ cards });
}
export function parseOemgarageDetail(
  raw: string,
  card: OemgarageCard,
): OemgarageRecord {
  OemgarageCardSchema.parse(card);
  const html = document(raw);
  const canonical = [...html.matchAll(/<link\b[^>]*>/gi)].filter(
    ([tag]) => prattAttribute(tag, "rel") === "canonical",
  );
  if (
    canonical.length !== 1 ||
    prattAttribute(canonical[0]?.[0] ?? "", "href") !== card.url
  )
    throw new Error("oeM Garage donor canonical destination changed");
  const region = prattRegion(html, (tag) => prattClass(tag, "oemg-dh"));
  const headings = prattElements(region, "h2"),
    titles = prattElements(html, "h1");
  const subs = prattElements(region, "p", (tag) =>
    prattClass(tag, "oemg-dh-sub"),
  );
  const stock =
    /^Stock #([1-9]\d*) · ([\d,]+) parts? in stock from this car$/.exec(
      prattText(subs[0]?.body ?? ""),
    );
  const tables = prattElements(region, "table");
  if (
    headings.length !== 1 ||
    titles.length !== 1 ||
    subs.length !== 1 ||
    !stock ||
    stock[1] !== card.id ||
    tables.length !== 1
  )
    throw new Error(
      "oeM Garage required donor stock/join or metadata boundary changed",
    );
  const fields: Record<string, string> = {};
  for (const row of prattElements(tables[0]?.body ?? "", "tr")) {
    const keys = prattElements(row.body, "th"),
      values = prattElements(row.body, "td");
    const key = prattText(keys[0]?.body ?? "");
    if (keys.length !== 1 || values.length !== 1 || !key || key in fields)
      throw new Error(
        "oeM Garage donor field labels are malformed or duplicated",
      );
    fields[key] = prattText(values[0]?.body ?? "");
  }
  const images = [...region.matchAll(/<img\b[^>]*>/gi)].filter(
    ([tag]) => prattAttribute(tag, "id") === "OemgDhMain",
  );
  return OemgarageRecordSchema.parse({
    card,
    title: prattText(titles[0]?.body ?? "").replace(/^Collection:\s*/, ""),
    header: prattText(headings[0]?.body ?? ""),
    stock: stock[1],
    partsCount: Number(stock[2]?.replaceAll(",", "")),
    fields,
    imageUrl:
      images.length === 1 ? prattAttribute(images[0]?.[0] ?? "", "src") : null,
  });
}
