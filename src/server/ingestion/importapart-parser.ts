import { z } from "zod";
import {
  inventoryHtmlAttribute,
  stripInventoryRawText,
} from "./inventory-html";
import {
  IMPORTAPART_CATALOG,
  IMPORTAPART_ORIGIN,
  verifyImportapartYard,
} from "./importapart-yard-metadata";

export function isImportapartDonorUrl(raw: string): boolean {
  const url = URL.parse(raw);
  return (
    url !== null &&
    url.origin === IMPORTAPART_ORIGIN &&
    !url.username &&
    !url.password &&
    !url.search &&
    !url.hash &&
    /^\/blogs\/part-outs\/[a-z0-9]+(?:-[a-z0-9]+)*$/.test(url.pathname)
  );
}
export const ImportapartPostSchema = z
  .object({
    url: z.string().max(1000).refine(isImportapartDonorUrl),
    title: z.string().trim().min(1).max(500),
  })
  .strict();
export type ImportapartPost = z.infer<typeof ImportapartPostSchema>;
export const ImportapartCatalogSchema = z
  .object({
    page: z.number().int().min(1).max(1000),
    lastPage: z.number().int().min(1).max(1000),
    posts: z.array(ImportapartPostSchema).min(1).max(12),
  })
  .strict()
  .superRefine((catalog, context) => {
    if (
      catalog.page > catalog.lastPage ||
      (catalog.page < catalog.lastPage && catalog.posts.length !== 12)
    )
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Importapart nonterminal pages must contain all 12 native donor cards",
      });
  });
export type ImportapartCatalog = z.infer<typeof ImportapartCatalogSchema>;
export const ImportapartRecordSchema = z
  .object({
    post: ImportapartPostSchema,
    title: z.string().max(500),
    header: z.string().max(1000),
    vin: z.string().max(100),
    stock: z.string().max(100),
  })
  .strict();
export type ImportapartRecord = z.infer<typeof ImportapartRecordSchema>;

function text(raw: string): string {
  const named = new Map([
    ["amp", "&"],
    ["nbsp", " "],
    ["quot", '"'],
    ["apos", "'"],
    ["lt", "<"],
    ["gt", ">"],
    ["ndash", "\u2013"],
    ["mdash", "\u2014"],
    ["rsquo", "'"],
    ["lsquo", "'"],
    ["rdquo", '"'],
    ["ldquo", '"'],
    ["hellip", "..."],
  ]);
  return raw
    .replace(/<[^>]*>/g, " ")
    .replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (entity: string, key: string) => {
      if (!key.startsWith("#")) {
        const value = named.get(key.toLowerCase());
        if (value === undefined)
          throw new Error("Unsupported Importapart entity " + entity);
        return value;
      }
      const hex = /^#x/i.test(key);
      const point = Number.parseInt(key.slice(hex ? 2 : 1), hex ? 16 : 10);
      if (
        point <= 0 ||
        point > 0x10ffff ||
        (point >= 0xd800 && point <= 0xdfff)
      )
        throw new Error("Invalid Importapart character reference");
      return String.fromCodePoint(point);
    })
    .replace(/\s+/g, " ")
    .trim();
}
const hasClass = (tag: string, suffix: string) =>
  inventoryHtmlAttribute(tag, "class")
    ?.split(/\s+/)
    .some((value) => value.endsWith(suffix)) ?? false;
function document(html: string): string {
  const clean = stripInventoryRawText(html);
  if (html.length > 4_000_000 || !/<\/html>\s*$/i.test(clean))
    throw new Error("Importapart document is oversized or truncated");
  verifyImportapartYard(html);
  return clean;
}
export function importapartTitleKey(raw: string): string {
  return raw
    .replace(/\s*-?\s*part\s*out\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}
export function parseImportapartCatalog(
  html: string,
  page: number,
): ImportapartCatalog {
  const clean = document(html);
  const plain = clean
    .replace(/<[^>]*>/g, " ")
    .replace(/&#0*39;|&apos;|&rsquo;/gi, "'")
    .replace(/\s+/g, " ");
  if (
    !plain.includes("CURRENT INVENTORY") ||
    !plain.includes("Browse the vehicles we're currently parting out.")
  )
    throw new Error("Importapart current donor inventory scope changed");
  const cards = [...clean.matchAll(/(<a\b[^>]*>)([\s\S]*?)<\/a>/gi)].filter(
    (m) => hasClass(m[1] ?? "", "__card"),
  );
  const openings = [...clean.matchAll(/<a\b[^>]*>/gi)].filter(([tag]) =>
    hasClass(tag, "__card"),
  );
  if (!cards.length || cards.length !== openings.length || cards.length > 100)
    throw new Error("Importapart donor cards are empty or incomplete");
  const posts = cards.map((card) => {
    if (/<a\b/i.test(card[2] ?? ""))
      throw new Error("Nested Importapart donor anchor");
    const href = inventoryHtmlAttribute(card[1] ?? "", "href");
    const url = href ? URL.parse(text(href), IMPORTAPART_ORIGIN) : null;
    const headings = [
      ...(card[2] ?? "").matchAll(/(<h2\b[^>]*>)([\s\S]*?)<\/h2>/gi),
    ];
    if (
      headings.length !== 1 ||
      !hasClass(headings[0]?.[1] ?? "", "__card-title")
    )
      throw new Error("Importapart donor card title changed");
    return ImportapartPostSchema.parse({
      url: url?.href,
      title: text(headings[0]?.[2] ?? ""),
    });
  });
  const donorAnchors = [...clean.matchAll(/<a\b[^>]*>/gi)].filter(([tag]) => {
    const raw = inventoryHtmlAttribute(tag, "href");
    const url = raw ? URL.parse(text(raw), IMPORTAPART_ORIGIN) : null;
    return (
      url?.origin === IMPORTAPART_ORIGIN &&
      url.pathname.startsWith("/blogs/part-outs/")
    );
  });
  if (
    donorAnchors.length !== posts.length ||
    new Set(posts.map((p) => p.url)).size !== posts.length
  )
    throw new Error(
      "Importapart donor links are duplicated or outside the card contract",
    );
  const paginations = [
    ...clean.matchAll(/(<div\b[^>]*>)([\s\S]*?)<\/div>/gi),
  ].filter((m) => hasClass(m[1] ?? "", "__pagination"));
  const pagination = paginations[0]?.[2];
  if (
    paginations.length !== 1 ||
    pagination === undefined ||
    /<div\b/i.test(pagination)
  )
    throw new Error("Importapart native pagination is missing or changed");
  const current = [
    ...pagination.matchAll(/(<span\b[^>]*>)([\s\S]*?)<\/span>/gi),
  ].filter((m) => hasClass(m[1] ?? "", "partouts-pagination-current"));
  if (current.length !== 1 || text(current[0]?.[2] ?? "") !== String(page))
    throw new Error("Importapart ignored the requested catalog page");
  let lastPage = page;
  const next: number[] = [];
  for (const link of pagination.matchAll(/(<a\b[^>]*>)([\s\S]*?)<\/a>/gi)) {
    const href = inventoryHtmlAttribute(link[1] ?? "", "href");
    const url = href ? URL.parse(text(href), IMPORTAPART_ORIGIN) : null;
    const rawPage = url?.searchParams.get("page");
    const target =
      rawPage && /^[1-9]\d{0,3}$/.test(rawPage) ? Number(rawPage) : NaN;
    const label = text(link[2] ?? "");
    if (
      !url ||
      url.origin !== IMPORTAPART_ORIGIN ||
      url.pathname !== new URL(IMPORTAPART_CATALOG).pathname ||
      url.username ||
      url.password ||
      url.hash ||
      [...url.searchParams.keys()].length !== 1 ||
      !Number.isSafeInteger(target) ||
      target > 1000 ||
      ![String(target), "→", "←"].includes(label) ||
      (label === "←" && target !== page - 1)
    )
      throw new Error("Importapart pagination target is unverified");
    lastPage = Math.max(lastPage, target);
    if (label === "→") next.push(target);
  }
  if (
    (page < lastPage && (next.length !== 1 || next[0] !== page + 1)) ||
    (page === lastPage && next.length !== 0)
  )
    throw new Error(
      "Importapart pagination has a gap or missing terminal proof",
    );
  return ImportapartCatalogSchema.parse({ page, lastPage, posts });
}
export function parseImportapartDetail(
  html: string,
  post: ImportapartPost,
): ImportapartRecord {
  const clean = document(html);
  const titles = [...clean.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)];
  const title = text(titles[0]?.[1] ?? "");
  if (
    titles.length !== 1 ||
    importapartTitleKey(title) !== importapartTitleKey(post.title)
  )
    throw new Error(
      "Importapart donor title no longer matches its enumerated native post",
    );
  const contents = [
    ...clean.matchAll(
      /(<div\b[^>]*>)\s*<rte-formatter\b[^>]*>([\s\S]*?)<\/rte-formatter>\s*<\/div>/gi,
    ),
  ].filter((m) => hasClass(m[1] ?? "", "blog-post-content"));
  const content = contents[0]?.[2];
  if (
    contents.length !== 1 ||
    content === undefined ||
    /<rte-formatter\b/i.test(content)
  )
    throw new Error("Importapart donor description is incomplete");
  const native = content.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");
  if (
    !/7373 Hazelwood Ave(?:nue|\.)?\s*,?\s*Hazelwood,? (?:Missouri|MO) 63042/i.test(
      native,
    )
  )
    throw new Error(
      "Importapart donor does not establish physical salvage-yard ownership",
    );
  const first = /^\s*<p\b[^>]*>([\s\S]*?)<\/p>/i.exec(content)?.[1];
  if (first === undefined || /<p\b/i.test(first))
    throw new Error("Importapart donor header paragraph is missing");
  const firstLines = first.split(/<br\s*\/?\s*>/i);
  const header = text(firstLines[0] ?? "");
  // Two native posts split their title and labelled VIN across the first two
  // paragraphs. Extend only into an immediately adjacent VIN header paragraph.
  const second =
    /^\s*<p\b[^>]*>[\s\S]*?<\/p>\s*<p\b[^>]*>([\s\S]*?)<\/p>/i.exec(
      content,
    )?.[1];
  const secondHeader =
    second !== undefined && /^\s*VIN\s*:/i.test(second.replace(/<[^>]*>/g, " "))
      ? second
      : "";
  const metadata = first + "<br>" + secondHeader;
  const tokens = metadata.split(/<br\s*\/?\s*>/i).flatMap((raw) => {
    const line = raw.replace(/<[^>]*>/g, " ").trim();
    const labelled = [...line.matchAll(/\bVIN\s*:\s*([^\s<>]+)/gi)].map(
      (match) => text(match[1] ?? ""),
    );
    return labelled.length
      ? labelled
      : /^[A-HJ-NPR-Z0-9]{17}$/i.test(line)
        ? [line]
        : [];
  });
  if (tokens.length > 1)
    throw new Error(
      "Importapart donor header publishes multiple VIN identities",
    );
  let stock = "";
  try {
    const line = metadata
      .split(/<br\s*\/?\s*>/i)
      .find((raw) => /^\s*Stock\s*#/i.test(raw.replace(/<[^>]*>/g, " ")));
    const scalar =
      line === undefined
        ? ""
        : (/^Stock\s*#\s*:?\s*(.*)$/i.exec(text(line))?.[1] ?? "");
    stock = /^[A-Z0-9][A-Z0-9-]{1,39}$/i.test(scalar) ? scalar : "";
  } catch {
    // Stock is optional. Undecodable native scalar metadata remains null.
  }
  return ImportapartRecordSchema.parse({
    post,
    title,
    header,
    vin: tokens[0] ?? "",
    stock,
  });
}
