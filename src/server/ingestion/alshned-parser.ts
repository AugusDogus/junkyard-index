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

export const ALSHNED_ORIGIN = "https://alshnedauto.com";
export const ALSHNED_CATALOG = ALSHNED_ORIGIN + "/collections/new-arrivals-1";
export const ALSHNED_CONTACT = ALSHNED_ORIGIN + "/pages/contact";
export const ALSHNED_MAX_BYTES = 2 * 1024 * 1024;
export const ALSHNED_OWNER_HASH = createHash("sha256")
  .update(
    JSON.stringify([
      "Alshned Auto Parts",
      "1231 Hayes Blvd suite b",
      "Bristol PA 19007",
      "2678189509",
    ]),
  )
  .digest("hex");
export const alshnedHash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
function owned(raw: string): URL | null {
  const u = URL.parse(raw, ALSHNED_ORIGIN);
  return u &&
    u.origin === ALSHNED_ORIGIN &&
    !u.username &&
    !u.password &&
    !u.hash
    ? u
    : null;
}
export function alshnedListingPage(raw: string): number | null {
  const u = owned(raw);
  if (!u || u.pathname !== "/collections/new-arrivals-1") return null;
  if (!u.search) return 1;
  const m = /^\?page=([1-9]\d{0,2}|1000)$/.exec(u.search);
  return m ? Number(m[1]) : null;
}
export function alshnedDonorHandle(raw: string): string | null {
  const u = owned(raw);
  return u && !u.search
    ? (/^\/products\/(donor-vehicle-[a-z0-9]+(?:-[a-z0-9]+)*)$/.exec(
        u.pathname,
      )?.[1] ?? null)
    : null;
}
export const AlshnedCardSchema = z
  .object({
    handle: z.string().max(250),
    url: z.string().max(1000),
    title: z.string().max(300),
    vendor: z.string().max(100),
  })
  .strict()
  .superRefine((c, ctx) => {
    if (
      alshnedDonorHandle(c.url) !== c.handle ||
      c.url !== ALSHNED_ORIGIN + "/products/" + c.handle
    )
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Alshned donor destination/handle is foreign or changed",
      });
  });
export type AlshnedCard = z.infer<typeof AlshnedCardSchema>;
export const AlshnedPageSchema = z
  .object({
    url: z.string().max(1000),
    page: z.number().int().min(1).max(1000),
    lastPage: z.number().int().min(1).max(1000),
    total: z.number().int().min(1).max(24000),
    cards: z.array(AlshnedCardSchema).min(1).max(24),
    links: z
      .array(
        z
          .object({
            page: z.number().int().min(1).max(1000),
            url: z.string().max(1000),
          })
          .strict(),
      )
      .max(30),
    next: z.string().max(1000).nullable(),
    bytes: z.number().int().min(1).max(ALSHNED_MAX_BYTES),
  })
  .strict()
  .superRefine((p, ctx) => {
    if (
      alshnedListingPage(p.url) !== p.page ||
      p.lastPage !== Math.ceil(p.total / 24) ||
      p.page > p.lastPage ||
      p.cards.length !== Math.min(24, p.total - (p.page - 1) * 24) ||
      new Set(p.cards.map((c) => c.handle)).size !== p.cards.length ||
      p.links.some(
        (l) =>
          alshnedListingPage(l.url) !== l.page ||
          l.page > p.lastPage ||
          l.page === p.page,
      ) ||
      (p.page === p.lastPage
        ? p.next !== null
        : p.next === null ||
          alshnedListingPage(p.next) !== p.page + 1 ||
          !p.links.some((l) => l.url === p.next))
    )
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Alshned native count, page shape or continuation does not reconcile",
      });
  });
export type AlshnedPage = z.infer<typeof AlshnedPageSchema>;
export const AlshnedDonorSchema = z
  .object({
    card: AlshnedCardSchema,
    title: z.string().max(300),
    heading: z.string().max(300),
    brand: z.string().max(100),
    vin: z.string().max(100),
    jsonVin: z.string().max(100),
    vinClaims: z.array(z.string().max(100)).max(20),
    stock: z.string().max(100).nullable(),
    active: z.boolean(),
    imageUrl: z.string().max(3000).nullable(),
    fields: z.record(z.string().max(100), z.string().max(1000)),
    bytes: z.number().int().min(1).max(ALSHNED_MAX_BYTES),
  })
  .strict();
export type AlshnedDonor = z.infer<typeof AlshnedDonorSchema>;
function document(raw: string): string {
  const html = stripInventoryRawText(raw);
  if (
    Buffer.byteLength(raw) > ALSHNED_MAX_BYTES ||
    [/<html\b/gi, /<body\b/gi, /<\/body\s*>/gi, /<\/html\s*>/gi].some(
      (p) => [...html.matchAll(p)].length !== 1,
    ) ||
    !/<\/body\s*>\s*<\/html\s*>\s*$/i.test(html) ||
    /access denied|checking your browser|just a moment|request rejected|unusual traffic/i.test(
      prattText(html),
    )
  )
    throw new Error(
      "Alshned response is incomplete, oversized or contains access-control content",
    );
  const footers = prattElements(html, "footer");
  const footer = prattText(footers[0]?.body ?? "");
  if (
    footers.length !== 1 ||
    ![
      "Alshned Auto Parts",
      "1231 Hayes Blvd suite b, Bristol, Pennsylvania 19007, United States",
      "+1 267-818-9509",
    ].every((v) => footer.includes(v))
  )
    throw new Error(
      "Alshned native physical operator, address or phone changed",
    );
  return html;
}
function canonical(html: string, url: string) {
  const links = [...html.matchAll(/<link\b[^>]*>/gi)].filter(
    ([t]) => prattAttribute(t, "rel") === "canonical",
  );
  if (links.length !== 1 || prattAttribute(links[0]?.[0] ?? "", "href") !== url)
    throw new Error("Alshned canonical destination changed");
}
export function parseAlshnedOwner(raw: string): string {
  const html = document(raw);
  canonical(html, ALSHNED_CONTACT);
  const mains = prattElements(html, "main");
  if (
    mains.length !== 1 ||
    !prattText(mains[0]?.body ?? "").includes(
      "1231 Hayes Blvd suite b, Bristol, Pennsylvania 19007, United States",
    )
  )
    throw new Error("Alshned native contact identity changed");
  return ALSHNED_OWNER_HASH;
}
function parseCatalog(raw: string, url: string): AlshnedPage {
  const html = document(raw),
    page = alshnedListingPage(url);
  if (!page || URL.parse(url)?.href !== url)
    throw new Error("Invalid Alshned literal listing destination");
  canonical(html, url);
  const counts = prattElements(html, "span", (t) =>
    ["ProductCount", "ProductCountDesktop"].includes(
      prattAttribute(t, "id") ?? "",
    ),
  );
  const match = /^(\d+) products?$/.exec(prattText(counts[0]?.body ?? ""));
  if (
    counts.length !== 2 ||
    new Set(counts.map((c) => prattText(c.body))).size !== 1 ||
    !match
  )
    throw new Error("Alshned native donor count missing or changed");
  const grids = prattElements(
    html,
    "ul",
    (t) => prattAttribute(t, "id") === "product-grid",
  );
  if (grids.length !== 1)
    throw new Error("Alshned complete donor grid missing or duplicated");
  const rows = prattElements(grids[0]?.body ?? "", "li");
  const cards = rows.map((row) => {
    if (!prattClass(row.tag, "grid__item"))
      throw new Error("Unknown Alshned donor row shape");
    const anchors = prattElements(row.body, "a"),
      headings = prattElements(row.body, "h3");
    const urls = anchors.map(
      (a) => owned(prattAttribute(a.tag, "href") ?? "")?.href ?? "",
    );
    const titles = headings.map((h) => prattText(h.body));
    const vendors = prattElements(row.body, "div", (t) =>
      prattClass(t, "caption-with-letter-spacing"),
    );
    if (
      anchors.length !== 2 ||
      new Set(urls).size !== 1 ||
      headings.length !== 2 ||
      new Set(titles).size !== 1 ||
      vendors.length !== 1 ||
      !titles[0]?.startsWith("Donor vehicle ")
    )
      throw new Error(
        "Alshned donor card faces, title or vendor boundary changed",
      );
    return AlshnedCardSchema.parse({
      handle: alshnedDonorHandle(urls[0] ?? ""),
      url: urls[0],
      title: titles[0],
      vendor: prattText(vendors[0]?.body ?? ""),
    });
  });
  const navs = prattElements(html, "nav", (t) => prattClass(t, "pagination"));
  const nav = navs[0]?.body ?? "";
  const current = prattElements(
    nav,
    "span",
    (t) => prattAttribute(t, "aria-current") === "page",
  );
  if (
    Math.ceil(Number(match[1]) / 24) > 1
      ? navs.length !== 1 ||
        current.length !== 1 ||
        prattText(current[0]?.body ?? "") !== String(page)
      : navs.length !== 0
  )
    throw new Error("Alshned pagination current page changed");
  const nexts: string[] = [];
  const links = prattElements(nav, "a").map((a) => {
    const href = prattAttribute(a.tag, "href") ?? "",
      parsed = owned(href),
      n = alshnedListingPage(href);
    if (!parsed || !n)
      throw new Error("Alshned foreign or unknown pagination control");
    if (prattAttribute(a.tag, "aria-label") === "Next page")
      nexts.push(parsed.href);
    return { page: n, url: parsed.href };
  });
  if (nexts.length > 1) throw new Error("Alshned continuation duplicated");
  return AlshnedPageSchema.parse({
    url,
    page,
    total: Number(match[1]),
    lastPage: Math.ceil(Number(match[1]) / 24),
    cards,
    links,
    next: nexts[0] ?? null,
    bytes: Buffer.byteLength(raw),
  });
}
export const AlshnedCatalog = {
  parse: parseCatalog,
  membership: ({ bytes: _bytes, ...membership }: AlshnedPage) => membership,
} as const;
const ProductSchema = z.object({
  "@type": z.literal("Product"),
  name: z.string().max(300),
  url: z.string().max(1000),
  description: z.string().max(100000),
  brand: z.object({ name: z.string().max(100) }),
  image: z.array(z.string().max(3000)).max(100).optional(),
  offers: z
    .array(
      z.object({
        availability: z.string(),
        url: z.string(),
        sku: z.string().max(100).optional(),
      }),
    )
    .min(1)
    .max(20),
});
const vinClaims = (raw: string) =>
  [...raw.matchAll(/^VIN\s*#?\s*:?\s*(\S+)$/gim)].map((m) => m[1] ?? "");
export function alshnedImage(raw: string | null): string | null {
  const image = raw ? owned(raw) : null;
  return image &&
    /^\/cdn\/shop\/(?:files|products)\/[a-z0-9_.%-]+\.(?:jpe?g|png|webp)$/i.test(
      image.pathname,
    ) &&
    /^\?v=\d+$/.test(image.search)
    ? image.href
    : null;
}
function parseDonor(raw: string, card: AlshnedCard): AlshnedDonor {
  AlshnedCardSchema.parse(card);
  const html = document(raw);
  canonical(html, card.url);
  const products: z.infer<typeof ProductSchema>[] = [];
  for (const s of prattElements(
    raw,
    "script",
    (t) => prattAttribute(t, "type") === "application/ld+json",
  )) {
    const value: unknown = JSON.parse(s.body);
    if (z.object({ "@type": z.literal("Product") }).safeParse(value).success)
      products.push(ProductSchema.parse(value));
  }
  const product = products[0];
  if (products.length !== 1 || !product || product.url !== card.url)
    throw new Error("Alshned primary Product identity/destination changed");
  const region = prattRegion(html, (t) =>
    prattClass(t, "product__description"),
  );
  const headings = prattElements(region, "h2");
  if (headings.length !== 1)
    throw new Error("Alshned primary donor heading boundary changed");
  const lines = region
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<\/p\s*>/gi, "\n")
    .split("\n")
    .map(prattText)
    .filter(Boolean);
  const fields: Record<string, string> = {};
  for (const key of ["Exterior Color", "Engine", "Transmission"]) {
    const values = lines
      .filter((l) => l.startsWith(key + ":"))
      .map((l) => l.slice(key.length + 1).trim());
    if (values.length === 1 && values[0]) fields[key] = values[0];
  }
  const imageUrl = alshnedImage(product.image?.[0] ?? null);
  const visibleVins = vinClaims(lines.join("\n")),
    structuredVins = vinClaims(product.description);
  const stocks = [...new Set(product.offers.map((o) => o.sku ?? ""))];
  if (
    product.offers.some((o) => {
      const u = owned(o.url);
      return (
        !u ||
        u.pathname !== URL.parse(card.url)?.pathname ||
        !/^\?variant=\d+$/.test(u.search)
      );
    })
  )
    throw new Error(
      "Alshned product offer escapes its native donor destination",
    );
  return AlshnedDonorSchema.parse({
    card,
    title: product.name,
    heading: prattText(headings[0]?.body ?? ""),
    brand: product.brand.name,
    vin: visibleVins[0] ?? "",
    jsonVin: structuredVins[0] ?? "",
    vinClaims: [...new Set([...visibleVins, ...structuredVins])],
    stock: stocks.length === 1 ? stocks[0] || null : null,
    active:
      product.offers.every(
        (o) =>
          o.availability === "http://schema.org/InStock" ||
          o.availability === "https://schema.org/InStock",
      ) &&
      !/\b(?:whole\s+(?:vehicle|car|donor)\s+(?:is\s+)?sold|(?:vehicle|car|donor)\s+(?:(?:has\s+been|is|was)\s+)?(?:sold|scrapped|removed))\b/i.test(
        prattText(region),
      ),
    imageUrl,
    fields,
    bytes: Buffer.byteLength(raw),
  });
}
export const AlshnedDonor = { parse: parseDonor } as const;
