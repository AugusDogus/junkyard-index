import { createHash } from "node:crypto";
import { z } from "zod";
import { inventoryHtmlAttribute } from "./inventory-html";
import {
  citymotorsDivs,
  citymotorsDocument,
  citymotorsHasClass,
  citymotorsText,
} from "./citymotors-html";
import {
  citymotorsCatalogPage,
  citymotorsImage,
  isCitymotorsDonorUrl,
} from "./citymotors-yard-metadata";

export const citymotorsHash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
export const CitymotorsPostSchema = z
  .object({
    url: z.string().max(1000).refine(isCitymotorsDonorUrl),
    title: z.string().min(1).max(500),
    imageUrl: z
      .string()
      .max(1000)
      .refine((raw) => citymotorsImage(raw) !== null)
      .nullable(),
  })
  .strict();
export type CitymotorsPost = z.infer<typeof CitymotorsPostSchema>;
export const CitymotorsCatalogSchema = z
  .object({
    url: z.string().refine((raw) => citymotorsCatalogPage(raw) !== null),
    page: z.number().int().min(1).max(32),
    lastPage: z.number().int().min(1).max(32),
    next: z
      .string()
      .refine((raw) => citymotorsCatalogPage(raw) !== null)
      .nullable(),
    posts: z.array(CitymotorsPostSchema).min(1).max(32),
    hash: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export type CitymotorsCatalog = z.infer<typeof CitymotorsCatalogSchema>;
export const citymotorsCatalogHash = (page: Omit<CitymotorsCatalog, "hash">) =>
  citymotorsHash([page.url, page.page, page.lastPage, page.next, page.posts]);
function activeOwnYardProse(description: string): boolean {
  return (
    /arrived at our warehouse near Chicago/i.test(description) &&
    /we are dismantling/i.test(description) &&
    /removed and quality-checked in-house/i.test(description) &&
    /Local pickup in River Grove, IL/i.test(description) &&
    !/vehicle has been crushed|vehicle is no longer available|not our vehicle|sold whole|foreign supplier/i.test(
      description,
    )
  );
}
export const CitymotorsRecordSchema = z
  .object({
    post: CitymotorsPostSchema,
    heading: z.string().max(500),
    fields: z
      .array(z.tuple([z.string().max(100), z.string().max(1000)]))
      .max(40),
    status: z.literal("Available").nullable(),
    description: z.string().max(20_000),
  })
  .strict()
  .superRefine((record, context) => {
    if (!activeOwnYardProse(record.description))
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "City Motors donor active own-yard scope changed; inspect the native detail",
      });
  });
export type CitymotorsRecord = z.infer<typeof CitymotorsRecordSchema>;

function optionalCardImage(card: string): string | null {
  const images = new Set<string>();
  for (const [tag] of card.matchAll(/<img\b[^>]*>/gi)) {
    try {
      const raw = inventoryHtmlAttribute(tag, "data-full-src");
      if (raw === null) continue;
      const image = citymotorsImage(raw);
      if (image === null) return null;
      images.add(image);
    } catch {
      // Ambiguous optional image attributes cannot invalidate native identity.
      return null;
    }
  }
  return images.size === 1 ? ([...images][0] ?? null) : null;
}

function primaryStatus(primary: string): string | null {
  const paragraphs: string[] = [];
  let depth = 0;
  let start: number | null = null;
  for (const match of primary.matchAll(/<\/?(div|p)\b[^>]*>/gi)) {
    const closing = /^<\//.test(match[0]);
    if (match[1]?.toLowerCase() === "div") {
      depth += closing ? -1 : 1;
    } else if (depth === 1) {
      if (!closing) {
        if (start !== null)
          throw new Error("City Motors primary status paragraph is malformed");
        start = match.index + match[0].length;
      } else {
        if (start === null)
          throw new Error("City Motors primary status paragraph is malformed");
        paragraphs.push(citymotorsText(primary.slice(start, match.index)));
        start = null;
      }
    }
  }
  if (start !== null)
    throw new Error("City Motors primary status paragraph is incomplete");
  if (paragraphs.some((status) => status !== "Available"))
    throw new Error(
      "City Motors donor active own-yard scope changed; inspect every direct native status",
    );
  return paragraphs.length ? "Available" : null;
}

const owner = z.object({
  "@type": z.literal("AutoPartsStore"),
  name: z.literal("City Motors Parts"),
  url: z.literal("https://citymotorsparts.com/"),
  telephone: z.literal("+1-708-395-5602"),
  address: z.object({
    streetAddress: z.literal("2150 West St"),
    addressLocality: z.literal("River Grove"),
    addressRegion: z.literal("IL"),
    postalCode: z.literal("60171"),
  }),
  geo: z.object({
    latitude: z.literal("41.9274"),
    longitude: z.literal("-87.8398"),
  }),
});
function document(raw: string): string {
  const clean = citymotorsDocument(raw);
  let owners = 0;
  for (const match of raw.matchAll(
    /(<script\b[^>]*>)([\s\S]*?)<\/script\s*>/gi,
  )) {
    if (
      inventoryHtmlAttribute(match[1] ?? "", "type") !== "application/ld+json"
    )
      continue;
    const value: unknown = JSON.parse(match[2] ?? "");
    const type = z.object({ "@type": z.unknown().optional() }).safeParse(value);
    if (type.success && type.data["@type"] === "AutoPartsStore") {
      owner.parse(value);
      owners++;
    }
  }
  if (
    owners !== 1 ||
    !/City Motors Chicago\s+2150 West St\s+River Grove IL 60171/.test(
      citymotorsText(clean),
    )
  )
    throw new Error(
      "City Motors native physical ownership changed; inspect the official source",
    );
  return clean;
}
export function parseCitymotorsCatalog(
  raw: string,
  url: string,
): CitymotorsCatalog {
  const page = citymotorsCatalogPage(url);
  if (page === null)
    throw new Error("Unpublished City Motors catalog destination");
  const html = document(raw);
  const headings = [...html.matchAll(/(<h1\b[^>]*>)([\s\S]*?)<\/h1>/gi)].filter(
    ([_, tag]) => citymotorsHasClass(tag ?? "", "slider-title"),
  );
  if (
    headings.length !== 1 ||
    citymotorsText(headings[0]?.[2] ?? "") !== "Cars"
  )
    throw new Error("City Motors Cars catalog scope changed");
  const posts = citymotorsDivs(html, "product-item").map((card) => {
    const titles = [...card.matchAll(/(<a\b[^>]*>)([\s\S]*?)<\/a>/gi)].filter(
      ([_, tag]) => citymotorsHasClass(tag ?? "", "product-item-title"),
    );
    if (titles.length !== 1)
      throw new Error("City Motors card needs one complete donor title");
    const tag = titles[0]?.[1] ?? "";
    const destination = citymotorsText(
      inventoryHtmlAttribute(tag, "href") ?? "",
    );
    const aliases = [...card.matchAll(/<a\b[^>]*>/gi)].map(([anchor]) =>
      citymotorsText(inventoryHtmlAttribute(anchor, "href") ?? ""),
    );
    if (aliases.some((alias) => alias !== destination))
      throw new Error("City Motors card donor destinations contradict");
    return CitymotorsPostSchema.parse({
      url: destination,
      title: citymotorsText(titles[0]?.[2] ?? ""),
      imageUrl: optionalCardImage(card),
    });
  });
  if (new Set(posts.map((post) => post.url)).size !== posts.length)
    throw new Error("City Motors catalog repeats a donor destination");
  const navigations = [
    ...html.matchAll(/(<nav\b[^>]*>)([\s\S]*?)<\/nav>/gi),
  ].filter(([_, tag]) => citymotorsHasClass(tag ?? "", "pagination"));
  const navigation = navigations[0]?.[2];
  if (navigations.length !== 1 || navigation === undefined)
    throw new Error("City Motors catalog pagination is missing");
  const current = [
    ...navigation.matchAll(/(<span\b[^>]*>)([\s\S]*?)<\/span>/gi),
  ].filter(
    ([_, tag]) => inventoryHtmlAttribute(tag ?? "", "aria-current") === "page",
  );
  if (
    current.length !== 1 ||
    citymotorsText(current[0]?.[2] ?? "") !== String(page)
  )
    throw new Error("City Motors ignored the requested catalog page");
  let lastPage = page;
  const next: string[] = [];
  for (const match of navigation.matchAll(/<a\b[^>]*>/gi)) {
    const href = citymotorsText(inventoryHtmlAttribute(match[0], "href") ?? "");
    const number = citymotorsCatalogPage(href);
    if (number === null)
      throw new Error(
        "City Motors pagination contains an unverified destination",
      );
    lastPage = Math.max(lastPage, number);
    if (citymotorsHasClass(match[0], "next")) next.push(href);
  }
  if (
    (page < lastPage &&
      (next.length !== 1 ||
        citymotorsCatalogPage(next[0] ?? "") !== page + 1 ||
        posts.length !== 32)) ||
    (page === lastPage && next.length !== 0)
  )
    throw new Error(
      "City Motors pagination is incomplete or has no terminal proof",
    );
  const value = { url, page, lastPage, next: next[0] ?? null, posts };
  return CitymotorsCatalogSchema.parse({
    ...value,
    hash: citymotorsCatalogHash(value),
  });
}
export function parseCitymotorsDetail(
  raw: string,
  post: CitymotorsPost,
): CitymotorsRecord {
  CitymotorsPostSchema.parse(post);
  const html = document(raw);
  const canonical = [...html.matchAll(/<link\b[^>]*>/gi)].filter(
    ([tag]) => inventoryHtmlAttribute(tag, "rel") === "canonical",
  );
  if (
    canonical.length !== 1 ||
    inventoryHtmlAttribute(canonical[0]?.[0] ?? "", "href") !== post.url
  )
    throw new Error(
      "City Motors donor canonical contradicts its published destination",
    );
  const headings = [...html.matchAll(/(<h1\b[^>]*>)([\s\S]*?)<\/h1>/gi)].filter(
    ([_, tag]) => citymotorsHasClass(tag ?? "", "product-page-title"),
  );
  const primary = citymotorsDivs(html, "right-product-description");
  const descriptions = citymotorsDivs(html, "product-description-block");
  if (
    headings.length !== 1 ||
    primary.length !== 1 ||
    descriptions.length !== 1
  )
    throw new Error(
      "City Motors primary donor regions are missing or incomplete",
    );
  const heading = citymotorsText(
    (headings[0]?.[2] ?? "").replace(
      /<span\b[^>]*class=["']product-sku["'][^>]*>[\s\S]*?<\/span>/gi,
      "",
    ),
  );
  const tables = [
    ...(primary[0] ?? "").matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi),
  ];
  if (tables.length !== 1 || /<table\b/i.test(tables[0]?.[1] ?? ""))
    throw new Error("City Motors primary field table changed");
  const table = tables[0]?.[1] ?? "";
  const rows = [...table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)];
  if (rows.length !== [...table.matchAll(/<tr\b/gi)].length)
    throw new Error("City Motors primary field table is truncated");
  const fields: [string, string][] = rows.map((row) => {
    const cells = [...(row[1] ?? "").matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)];
    if (cells.length !== 2)
      throw new Error("City Motors primary field row is malformed");
    return [
      citymotorsText(cells[0]?.[1] ?? "").replace(/:$/, ""),
      citymotorsText(cells[1]?.[1] ?? ""),
    ];
  });
  const status = primaryStatus(primary[0] ?? "");
  const description = citymotorsText(descriptions[0] ?? "");
  if (!activeOwnYardProse(description))
    throw new Error(
      "City Motors donor active own-yard scope changed; inspect the native detail",
    );
  return CitymotorsRecordSchema.parse({
    post,
    heading,
    fields,
    status,
    description,
  });
}
