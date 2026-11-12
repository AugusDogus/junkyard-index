import { createHash } from "node:crypto";
import { z } from "zod";
import {
  inventoryHtmlAttribute,
  stripInventoryRawText,
} from "./inventory-html";
import { RUSTYHOOK_CATALOG, RUSTYHOOK_ORIGIN } from "./rustyhook-yard-metadata";

export const RUSTYHOOK_MAX_PAGES = 32;
export const RUSTYHOOK_MAX_DONORS = RUSTYHOOK_MAX_PAGES * 12;
export const RUSTYHOOK_MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
export const rustyhookHash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const receipt = z
  .object({
    bodyHash: hash,
    bytes: z.number().int().positive().max(RUSTYHOOK_MAX_RESPONSE_BYTES),
  })
  .strict();

export function rustyhookListingPage(raw: string): number | null {
  const url = URL.parse(raw);
  if (
    !url ||
    url.origin !== RUSTYHOOK_ORIGIN ||
    url.username ||
    url.password ||
    url.hash
  )
    return null;
  if (url.href === RUSTYHOOK_CATALOG) return 1;
  const match = /^\?SPage=(0|[1-9]\d*)$/.exec(url.search);
  const page = Number(match?.[1]) + 1;
  return url.pathname === "/index.php" && match && page <= RUSTYHOOK_MAX_PAGES
    ? page
    : null;
}
export function isRustyhookDonorUrl(raw: string): boolean {
  const url = URL.parse(raw);
  return (
    url !== null &&
    url.origin === RUSTYHOOK_ORIGIN &&
    !url.username &&
    !url.password &&
    !url.hash &&
    url.pathname === "/index.php" &&
    /^\?E=Detail&ID=(0|[1-9]\d*)$/.test(url.search)
  );
}
export const RustyhookPostSchema = z
  .object({
    url: z.string().max(1000).refine(isRustyhookDonorUrl),
    title: z.string().trim().min(1).max(500),
  })
  .strict();
export type RustyhookPost = z.infer<typeof RustyhookPostSchema>;
const pageLink = z
  .object({
    page: z.number().int().min(1).max(RUSTYHOOK_MAX_PAGES),
    url: z
      .string()
      .max(1000)
      .refine((url) => rustyhookListingPage(url) !== null),
  })
  .strict();
export const RustyhookCatalogSchema = z
  .object({
    url: z
      .string()
      .max(1000)
      .refine((url) => rustyhookListingPage(url) !== null),
    page: z.number().int().min(1).max(RUSTYHOOK_MAX_PAGES),
    lastPage: z.number().int().min(1).max(RUSTYHOOK_MAX_PAGES),
    links: z.array(pageLink).max(RUSTYHOOK_MAX_PAGES - 1),
    posts: z.array(RustyhookPostSchema).min(1).max(12),
    receipt,
  })
  .strict()
  .superRefine((page, context) => {
    const expected = Array.from(
      { length: page.lastPage },
      (_, index) => index + 1,
    ).filter((number) => number !== page.page);
    if (
      rustyhookListingPage(page.url) !== page.page ||
      page.page > page.lastPage ||
      (page.page < page.lastPage && page.posts.length !== 12) ||
      JSON.stringify(page.links.map((link) => link.page)) !==
        JSON.stringify(expected) ||
      page.links.some((link) => rustyhookListingPage(link.url) !== link.page) ||
      new Set(page.posts.map((post) => post.url)).size !== page.posts.length
    )
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Rusty Hook listing has incomplete native pagination or duplicate donor membership",
      });
  });
export type RustyhookCatalog = z.infer<typeof RustyhookCatalogSchema>;
export const RustyhookRecordSchema = z
  .object({
    post: RustyhookPostSchema,
    heading: z.string().trim().min(1).max(500),
    fields: z.record(z.string().max(100), z.string().max(8192)),
    images: z.array(z.string().max(2000)).max(100),
    receipt,
  })
  .strict();
export type RustyhookRecord = z.infer<typeof RustyhookRecordSchema>;

export function rustyhookText(raw: string): string {
  const entities = new Map([
    ["amp", "&"],
    ["nbsp", " "],
    ["quot", '"'],
    ["apos", "'"],
    ["lt", "<"],
    ["gt", ">"],
    ["copy", "©"],
  ]);
  return raw
    .replace(/<[^>]*>/g, " ")
    .replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (whole: string, key: string) => {
      if (!key.startsWith("#")) return entities.get(key.toLowerCase()) ?? whole;
      const hex = /^#x/i.test(key);
      const point = Number.parseInt(key.slice(hex ? 2 : 1), hex ? 16 : 10);
      if (
        !Number.isSafeInteger(point) ||
        point <= 0 ||
        point > 0x10ffff ||
        (point >= 0xd800 && point <= 0xdfff)
      )
        throw new Error("Invalid Rusty Hook HTML character reference");
      return String.fromCodePoint(point);
    })
    .replace(/\s+/g, " ")
    .trim();
}
function document(html: string): string {
  const clean = stripInventoryRawText(html);
  const text = rustyhookText(clean);
  if (
    Buffer.byteLength(html) > RUSTYHOOK_MAX_RESPONSE_BYTES ||
    !/<\/html>\s*$/i.test(clean)
  )
    throw new Error("Rusty Hook document is oversized or truncated");
  if (
    !/Rusty Hook Auto Salvage in Pittsburgh 3015 Mt\. Troy Rd\. Pittsburgh, PA 15212/.test(
      text,
    ) ||
    !text.includes("Pittsburgh Yard Loose Parts") ||
    /727 Perry Hwy|access denied|request rejected|bot verification|checking your browser/i.test(
      text,
    )
  )
    throw new Error(
      "Rusty Hook Pittsburgh physical header, donor catalog scope or access content changed",
    );
  return clean;
}
function anchors(html: string, base: string) {
  const openings = [...html.matchAll(/<a\b[^>]*>/gi)];
  const matches = [...html.matchAll(/(<a\b[^>]*>)([\s\S]*?)<\/a\s*>/gi)];
  if (openings.length !== matches.length)
    throw new Error("Rusty Hook anchor is incomplete");
  return matches.map((match) => {
    const tag = match[1] ?? "";
    const body = match[2] ?? "";
    if (/<a\b/i.test(body)) throw new Error("Rusty Hook nested anchor");
    const href = inventoryHtmlAttribute(tag, "href");
    return {
      url: href ? (URL.parse(rustyhookText(href), base)?.href ?? "") : "",
      text: rustyhookText(body),
    };
  });
}
function bodyReceipt(html: string) {
  return {
    bodyHash: createHash("sha256").update(html).digest("hex"),
    bytes: Buffer.byteLength(html),
  };
}
export function rustyhookCatalogMembership(page: RustyhookCatalog) {
  return {
    url: page.url,
    page: page.page,
    lastPage: page.lastPage,
    links: page.links,
    posts: page.posts,
  };
}
export function parseRustyhookCatalog(
  html: string,
  url: string,
): RustyhookCatalog {
  const clean = document(html);
  const allAnchors = anchors(clean, url);
  const headings = [...clean.matchAll(/<h3\b[^>]*>([\s\S]*?)<\/h3\s*>/gi)].map(
    (match) => match[1] ?? "",
  );
  const pagination = headings.filter((heading) =>
    /^Previous\b/.test(rustyhookText(heading)),
  );
  if (pagination.length !== 2)
    throw new Error("Rusty Hook top/bottom native pagination is missing");
  const directories = pagination.map((heading) => {
    const numbers = rustyhookText(heading)
      .replace(/\b(?:Previous|Next)\b/g, "")
      .trim()
      .split(/\s+/)
      .map(Number);
    if (
      !numbers.length ||
      numbers.some((number, index) => number !== index + 1)
    )
      throw new Error("Rusty Hook published page numbers are not contiguous");
    const links = anchors(heading, url)
      .filter((anchor) => /^\d+$/.test(anchor.text))
      .map((anchor) => ({ page: Number(anchor.text), url: anchor.url }));
    const current = numbers.filter(
      (number) => !links.some((link) => link.page === number),
    );
    if (current.length !== 1)
      throw new Error("Rusty Hook selected native page is ambiguous");
    return { page: current[0], lastPage: numbers.length, links };
  });
  if (JSON.stringify(directories[0]) !== JSON.stringify(directories[1]))
    throw new Error("Rusty Hook top/bottom pagination conflicts");
  const posts = headings.flatMap((heading) =>
    anchors(heading, url)
      .filter((anchor) => isRustyhookDonorUrl(anchor.url))
      .map((anchor) => ({ url: anchor.url, title: anchor.text })),
  );
  const donorAnchors = allAnchors.filter((anchor) =>
    /[?&]E=Detail(?:&|$)/.test(anchor.url),
  );
  if (
    !posts.length ||
    donorAnchors.some(
      (anchor) =>
        !isRustyhookDonorUrl(anchor.url) ||
        !posts.some((post) => post.url === anchor.url),
    )
  )
    throw new Error(
      "Rusty Hook donor cards have missing, foreign or unbound destinations",
    );
  return RustyhookCatalogSchema.parse({
    url,
    ...directories[0],
    posts,
    receipt: bodyReceipt(html),
  });
}

const nativeLabels = new Set([
  "VIN",
  "Stock Number",
  "Year",
  "Make",
  "Model",
  "Mileage",
  "Engine",
  "Transmission",
  "Transfer Case",
  "Axle Ratio",
  "Body Style",
  "Interior Color",
  "Exterior Color",
  "Car Notes",
]);
export function rustyhookImageBound(raw: string, vin: string): boolean {
  const url = URL.parse(raw);
  return (
    !!url &&
    url.origin === RUSTYHOOK_ORIGIN &&
    !url.username &&
    !url.password &&
    !url.search &&
    !url.hash &&
    /^[A-Z0-9]{5,17}$/i.test(vin) &&
    url.pathname.startsWith(`/Salvage/${vin}/Images/`) &&
    !/%|(?:^|\/)\.\.(?:\/|$)/.test(url.pathname) &&
    /\.(?:jpe?g|png|webp)$/i.test(url.pathname)
  );
}
export function parseRustyhookDetail(
  html: string,
  post: RustyhookPost,
): RustyhookRecord {
  RustyhookPostSchema.parse(post);
  const clean = document(html);
  const headings = [...clean.matchAll(/<h2\b[^>]*>([\s\S]*?)<\/h2\s*>/gi)].map(
    (match) => rustyhookText(match[1] ?? ""),
  );
  if (headings.length !== 1 || headings[0] !== post.title)
    throw new Error(
      "Rusty Hook donor heading conflicts with its literal listing label",
    );
  const fields: Record<string, string> = {};
  for (const match of clean.matchAll(
    /<h3\b[^>]*>([\s\S]*?)<\/h3>\s*<\/td>\s*<\/tr>\s*<tr\b[^>]*>\s*<td\b[^>]*>([\s\S]*?)<\/td>/gi,
  )) {
    const label = rustyhookText(match[1] ?? "");
    if (!nativeLabels.has(label)) continue;
    if (
      Object.hasOwn(fields, label) ||
      /<\/?(?:table|tr|td)\b/i.test(match[2] ?? "")
    )
      throw new Error(
        "Rusty Hook native field is duplicated or structurally incomplete: " +
          label,
      );
    fields[label] = rustyhookText(match[2] ?? "");
  }
  for (const match of clean.matchAll(/<h3\b[^>]*>([\s\S]*?)<\/h3>/gi)) {
    const label = rustyhookText(match[1] ?? "");
    if (nativeLabels.has(label) && !Object.hasOwn(fields, label))
      throw new Error("Rusty Hook native field value is truncated: " + label);
  }
  const images = [...clean.matchAll(/<img\b[^>]*>/gi)].flatMap(([tag]) => {
    const src = inventoryHtmlAttribute(tag, "src");
    const url = src ? URL.parse(rustyhookText(src), post.url)?.href : undefined;
    return url && rustyhookImageBound(url, fields.VIN ?? "") ? [url] : [];
  });
  return RustyhookRecordSchema.parse({
    post,
    heading: headings[0],
    fields,
    images: [...new Set(images)],
    receipt: bodyReceipt(html),
  });
}
