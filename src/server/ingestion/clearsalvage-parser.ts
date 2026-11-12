import { createHash } from "node:crypto";
import { z } from "zod";
import {
  inventoryHtmlAttribute,
  stripInventoryRawText,
} from "./inventory-html";
import {
  CLEARSALVAGE_MAX_PAGES,
  CLEARSALVAGE_MAX_RESPONSE_BYTES,
  CLEARSALVAGE_PAGE_SIZE,
  clearsalvageCatalogPage,
  clearsalvageCatalogUrl,
  isClearsalvageDonorUrl,
} from "./clearsalvage-yard-metadata";

export const clearsalvageHash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const receipt = {
  bodyHash: z.string().regex(/^[a-f0-9]{64}$/),
  bodyBytes: z.number().int().positive().max(CLEARSALVAGE_MAX_RESPONSE_BYTES),
};
export const ClearsalvagePostSchema = z
  .object({
    id: z.number().int().positive(),
    title: z.string().min(1).max(500),
    url: z.string().max(1000).refine(isClearsalvageDonorUrl),
  })
  .strict();
export type ClearsalvagePost = z.infer<typeof ClearsalvagePostSchema>;
export const ClearsalvageCatalogSchema = z
  .object({
    url: z.string().refine((raw) => clearsalvageCatalogPage(raw) !== null),
    page: z.number().int().min(1).max(CLEARSALVAGE_MAX_PAGES),
    total: z
      .number()
      .int()
      .positive()
      .max(CLEARSALVAGE_MAX_PAGES * CLEARSALVAGE_PAGE_SIZE),
    lastPage: z.number().int().min(1).max(CLEARSALVAGE_MAX_PAGES),
    next: z.string().nullable(),
    posts: z.array(ClearsalvagePostSchema).min(1).max(CLEARSALVAGE_PAGE_SIZE),
    ...receipt,
  })
  .strict();
export type ClearsalvageCatalog = z.infer<typeof ClearsalvageCatalogSchema>;
const claims = z.array(z.string().max(20_000)).max(8);
export const ClearsalvageRecordSchema = z
  .object({
    post: ClearsalvagePostSchema,
    claims: z
      .object({
        year: claims,
        make: claims,
        model: claims,
        vin: claims,
        stock: claims,
        description: claims,
      })
      .strict(),
    ...receipt,
  })
  .strict();
export type ClearsalvageRecord = z.infer<typeof ClearsalvageRecordSchema>;
type Field = keyof ClearsalvageRecord["claims"];

/** Decode text without changing native spelling, punctuation or internal spaces. */
function nativeText(raw: string): string {
  const entities = new Map([
    ["amp", "&"],
    ["nbsp", " "],
    ["quot", '"'],
    ["apos", "'"],
    ["lt", "<"],
    ["gt", ">"],
    ["rsquo", "\u2019"],
    ["lsquo", "\u2018"],
    ["ndash", "\u2013"],
    ["mdash", "\u2014"],
  ]);
  return raw.replace(
    /&(#x[\da-f]+|#\d+|[a-z]+);/gi,
    (whole: string, key: string) => {
      if (!key.startsWith("#")) {
        const value = entities.get(key.toLowerCase());
        if (value === undefined)
          throw new Error(
            "Unsupported native Clear Salvage character reference " + whole,
          );
        return value;
      }
      const hex = /^#x/i.test(key);
      const point = Number.parseInt(key.slice(hex ? 2 : 1), hex ? 16 : 10);
      if (
        point <= 0 ||
        point > 0x10ffff ||
        (point >= 0xd800 && point <= 0xdfff)
      )
        throw new Error("Invalid native Clear Salvage character reference");
      return String.fromCodePoint(point);
    },
  );
}
function bodyReceipt(raw: string) {
  return {
    bodyHash: createHash("sha256").update(raw).digest("hex"),
    bodyBytes: Buffer.byteLength(raw),
  };
}
export function clearsalvageCatalogMembership(page: ClearsalvageCatalog) {
  return {
    url: page.url,
    page: page.page,
    total: page.total,
    lastPage: page.lastPage,
    next: page.next,
    posts: page.posts,
  };
}
export function parseClearsalvageCatalog(
  raw: string,
  url: string,
  headers: Headers,
): ClearsalvageCatalog {
  const page = clearsalvageCatalogPage(url);
  const integer = (name: string) => {
    const value = headers.get(name) ?? "";
    if (!/^[1-9]\d*$/.test(value))
      throw new Error(
        "Clear Salvage native " + name + " header is missing or invalid",
      );
    return Number(value);
  };
  const total = integer("x-wp-total"),
    lastPage = integer("x-wp-totalpages");
  if (
    page === null ||
    page > lastPage ||
    lastPage > CLEARSALVAGE_MAX_PAGES ||
    Math.ceil(total / CLEARSALVAGE_PAGE_SIZE) !== lastPage ||
    Buffer.byteLength(raw) > CLEARSALVAGE_MAX_RESPONSE_BYTES
  )
    throw new Error(
      "Clear Salvage native catalog count, page or body bound changed",
    );
  const value: unknown = JSON.parse(raw);
  const native = z
    .array(
      z.object({
        id: z.number().int().positive(),
        status: z.literal("publish"),
        type: z.literal("inventory"),
        link: z.string(),
        title: z.object({ rendered: z.string().min(1) }),
      }),
    )
    .max(CLEARSALVAGE_PAGE_SIZE)
    .parse(value);
  const posts = native.map((row) =>
    ClearsalvagePostSchema.parse({
      id: row.id,
      url: row.link,
      title: nativeText(row.title.rendered).trim(),
    }),
  );
  const expectedCount =
    page < lastPage
      ? CLEARSALVAGE_PAGE_SIZE
      : total - (page - 1) * CLEARSALVAGE_PAGE_SIZE;
  if (
    posts.length !== expectedCount ||
    new Set(posts.map((post) => post.url)).size !== posts.length ||
    posts.some(
      (post, index) => index > 0 && post.id <= (posts[index - 1]?.id ?? 0),
    )
  )
    throw new Error(
      "Clear Salvage native page is incomplete, unordered or repeats donor identities",
    );
  const expectedLinks = [
    ...(page > 1
      ? [{ rel: "prev", url: clearsalvageCatalogUrl(page - 1) }]
      : []),
    ...(page < lastPage
      ? [{ rel: "next", url: clearsalvageCatalogUrl(page + 1) }]
      : []),
  ];
  const links = (headers.get("link") ?? "")
    .split(",")
    .filter(Boolean)
    .map((link) => {
      const match = /^\s*<([^>]+)>;\s*rel="(next|prev)"\s*$/.exec(link);
      if (!match?.[1] || !match[2])
        throw new Error("Clear Salvage native pagination Link changed");
      return { url: match[1], rel: match[2] };
    });
  if (
    links.length !== expectedLinks.length ||
    expectedLinks.some(
      (expected) =>
        links.filter(
          (link) => link.rel === expected.rel && link.url === expected.url,
        ).length !== 1,
    )
  )
    throw new Error(
      "Clear Salvage native next/previous links do not close the declared roster",
    );
  return ClearsalvageCatalogSchema.parse({
    url,
    page,
    total,
    lastPage,
    next: links.find((link) => link.rel === "next")?.url ?? null,
    posts,
    ...bodyReceipt(raw),
  });
}

export function parseClearsalvageDetail(
  raw: string,
  post: ClearsalvagePost,
): ClearsalvageRecord {
  const clean = stripInventoryRawText(raw);
  if (
    Buffer.byteLength(raw) > CLEARSALVAGE_MAX_RESPONSE_BYTES ||
    !/<\/html\s*>\s*$/i.test(clean)
  )
    throw new Error("Clear Salvage primary HTML is oversized or truncated");
  const canonical = [...clean.matchAll(/<link\b[^>]*>/gi)]
    .filter(([tag]) => inventoryHtmlAttribute(tag, "rel") === "canonical")
    .map(([tag]) => inventoryHtmlAttribute(tag, "href"));
  const bodies = [...clean.matchAll(/<body\b[^>]*>/gi)];
  const ids = (inventoryHtmlAttribute(bodies[0]?.[0] ?? "", "class") ?? "")
    .split(/\s+/)
    .filter((name) => name.startsWith("postid-"));
  if (
    bodies.length !== 1 ||
    ids.length !== 1 ||
    ids[0] !== "postid-" + post.id ||
    canonical.length !== 1 ||
    canonical[0] !== post.url
  )
    throw new Error(
      "Clear Salvage primary canonical/post identity disagrees with the enumerated native donor",
    );
  const fields: ClearsalvageRecord["claims"] = {
    year: [],
    make: [],
    model: [],
    vin: [],
    stock: [],
    description: [],
  };
  const acf = new Map<string, Field>([
    ["acf_year", "year"],
    ["acf_model", "model"],
    ["acf_vin", "vin"],
    ["acf_stock", "stock"],
    ["acf_description", "description"],
  ]);
  let articleDepth = 0;
  let capture: { field: Field; depth: number; text: string } | null = null;
  for (const token of clean.matchAll(
    /<\/?([a-z][a-z0-9]*)\b[^>]*>|([^<]+)/gi,
  )) {
    const tag = token[1]?.toLowerCase();
    if (!tag) {
      if (capture) capture.text += token[2] ?? "";
      continue;
    }
    const closing = token[0].startsWith("</");
    if (tag === "article") {
      if (capture)
        throw new Error(
          "Clear Salvage primary field crosses a related article boundary",
        );
      articleDepth += closing ? -1 : 1;
      if (articleDepth < 0)
        throw new Error("Clear Salvage related article boundary is malformed");
    }
    if (tag !== "span") continue;
    if (capture) {
      capture.depth += closing ? -1 : 1;
      if (capture.depth === 0) {
        fields[capture.field].push(nativeText(capture.text));
        capture = null;
      }
    } else if (!closing && articleDepth === 0) {
      const field =
        inventoryHtmlAttribute(token[0], "data-shortcode") === "tcb_post_title"
          ? "make"
          : inventoryHtmlAttribute(token[0], "data-extra_key") === "CFG"
            ? acf.get(inventoryHtmlAttribute(token[0], "data-attr-id") ?? "")
            : undefined;
      if (field) capture = { field, depth: 1, text: "" };
    }
  }
  if (capture || articleDepth !== 0)
    throw new Error(
      "Clear Salvage primary field or related article is incomplete",
    );
  return ClearsalvageRecordSchema.parse({
    post,
    claims: fields,
    ...bodyReceipt(raw),
  });
}
