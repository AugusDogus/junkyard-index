import { createHash } from "node:crypto";
import { z } from "zod";
import { inventoryHtmlAttribute } from "~/server/ingestion/inventory-html";
import {
  WEBERBROTHERS_MAX_RESPONSE_BYTES,
  weberbrothersDocument,
  weberbrothersDivs,
  weberbrothersOneDiv,
  weberbrothersHasClass,
  weberbrothersText,
} from "./weberbrothers-html";
import {
  WEBERBROTHERS_ORIGIN,
  WEBERBROTHERS_CATALOG,
} from "./weberbrothers-yard-metadata";

export const WEBERBROTHERS_MAX_PAGES = 256;
export const WEBERBROTHERS_MAX_DONORS = WEBERBROTHERS_MAX_PAGES * 36;
export const weberbrothersHash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const receipt = z
  .object({
    bodyHash: z.string().regex(/^[a-f0-9]{64}$/),
    bytes: z.number().int().positive().max(WEBERBROTHERS_MAX_RESPONSE_BYTES),
  })
  .strict();
const bodyReceipt = (html: string) => ({
  bodyHash: createHash("sha256").update(html).digest("hex"),
  bytes: Buffer.byteLength(html),
});
function native(raw: string) {
  const url = URL.parse(raw);
  return url &&
    url.origin === WEBERBROTHERS_ORIGIN &&
    !url.username &&
    !url.password &&
    !url.hash
    ? url
    : null;
}
export function weberbrothersListingPage(raw: string): number | null {
  const url = native(raw);
  if (!url || url.search !== "?perpage=36") return null;
  if (url.href === WEBERBROTHERS_CATALOG) return 1;
  const match = /^\/product-category\/vehicles\/page\/([1-9]\d*)\/$/.exec(
    url.pathname,
  );
  const page = Number(match?.[1]);
  return page >= 2 && page <= WEBERBROTHERS_MAX_PAGES ? page : null;
}
export function isWeberbrothersDonorUrl(raw: string): boolean {
  const url = native(raw);
  return !!url && !url.search && /^\/product\/[a-z0-9-]+\/$/.test(url.pathname);
}
export const WeberbrothersPostSchema = z
  .object({
    url: z.string().max(1000).refine(isWeberbrothersDonorUrl),
    title: z.string().trim().min(1).max(500),
    stock: z.string().trim().max(100),
    nativePostId: z.string().regex(/^[1-9]\d*$/),
  })
  .strict();
export type WeberbrothersPost = z.infer<typeof WeberbrothersPostSchema>;
const pageNumber = z.number().int().min(1).max(WEBERBROTHERS_MAX_PAGES);
export const WeberbrothersCatalogSchema = z
  .object({
    url: z
      .string()
      .max(1000)
      .refine((url) => weberbrothersListingPage(url) !== null),
    page: pageNumber,
    lastPage: pageNumber,
    next: z.string().max(1000).nullable(),
    links: z
      .array(z.object({ page: pageNumber, url: z.string().max(1000) }).strict())
      .max(20),
    posts: z.array(WeberbrothersPostSchema).min(1).max(36),
    receipt,
  })
  .strict()
  .superRefine((page, context) => {
    if (
      weberbrothersListingPage(page.url) !== page.page ||
      page.page > page.lastPage ||
      (page.page < page.lastPage &&
        (page.posts.length !== 36 ||
          weberbrothersListingPage(page.next ?? "") !== page.page + 1)) ||
      (page.page === page.lastPage && page.next !== null) ||
      page.links.some(
        (link) =>
          weberbrothersListingPage(link.url) !== link.page ||
          link.page > page.lastPage,
      ) ||
      (page.lastPage > page.page &&
        !page.links.some((link) => link.page === page.lastPage)) ||
      new Set(page.posts.map((post) => post.url)).size !== page.posts.length ||
      new Set(page.posts.map((post) => post.nativePostId)).size !==
        page.posts.length
    )
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Weber native pagination or donor membership is incomplete",
      });
  });
export type WeberbrothersCatalog = z.infer<typeof WeberbrothersCatalogSchema>;
export const WeberbrothersRecordSchema = z
  .object({
    post: WeberbrothersPostSchema,
    heading: z.string().trim().min(1).max(500),
    stock: z.string().trim().max(100),
    fields: z.record(z.string().max(100), z.string().max(8192)),
    images: z.array(z.string().max(2000)).max(1),
    receipt,
  })
  .strict();
export type WeberbrothersRecord = z.infer<typeof WeberbrothersRecordSchema>;
export const weberbrothersCatalogMembership = (page: WeberbrothersCatalog) => ({
  url: page.url,
  page: page.page,
  lastPage: page.lastPage,
  next: page.next,
  links: page.links,
  posts: page.posts,
});
function anchors(html: string) {
  const matches = [...html.matchAll(/(<a\b[^>]*>)([\s\S]*?)<\/a\s*>/gi)];
  if (matches.length !== [...html.matchAll(/<a\b[^>]*>/gi)].length)
    throw new Error("Weber incomplete anchor");
  return matches.map((match) => ({
    tag: match[1] ?? "",
    text: weberbrothersText(match[2] ?? ""),
    url: weberbrothersText(
      inventoryHtmlAttribute(match[1] ?? "", "href") ?? "",
    ),
  }));
}
function optionalStock(html: string, label: string): string {
  const blocks = weberbrothersDivs(html, "sku");
  if (blocks.length > 1) throw new Error("Weber stock element is ambiguous");
  const block = blocks[0];
  if (!block) return "";
  const text = weberbrothersText(block.body);
  if (!text.startsWith(label))
    throw new Error("Weber native stock label changed");
  return text.slice(label.length).trim();
}
export function parseWeberbrothersCatalog(
  html: string,
  url: string,
): WeberbrothersCatalog {
  const clean = weberbrothersDocument(html);
  const loop = weberbrothersOneDiv(clean, "products-loop");
  const posts = weberbrothersDivs(loop.body, "product-loop-item").map(
    (item) => {
      if (!weberbrothersHasClass(item.tag, "product_cat-vehicles"))
        throw new Error("Weber listing contains a non-vehicle product");
      const ids = (inventoryHtmlAttribute(item.tag, "class") ?? "")
        .split(/\s+/)
        .flatMap((value) => /^post-([1-9]\d*)$/.exec(value)?.slice(1) ?? []);
      const title = anchors(weberbrothersOneDiv(item.body, "title").body);
      const stock = optionalStock(item.body, "Stock #:");
      if (
        ids.length !== 1 ||
        title.length !== 1 ||
        anchors(item.body).some((anchor) => anchor.url !== title[0]?.url)
      )
        throw new Error(
          "Weber donor native ID, title, stock label or destinations conflict",
        );
      return {
        url: title[0]?.url,
        title: title[0]?.text,
        stock,
        nativePostId: ids[0],
      };
    },
  );
  const navs = [
    ...clean.matchAll(/(<nav\b[^>]*>)([\s\S]*?)<\/nav\s*>/gi),
  ].filter((match) =>
    weberbrothersHasClass(match[1] ?? "", "woocommerce-pagination"),
  );
  const nav = navs[0]?.[2] ?? "";
  const current = [
    ...nav.matchAll(/(<span\b[^>]*>)([\s\S]*?)<\/span\s*>/gi),
  ].filter(
    (match) =>
      inventoryHtmlAttribute(match[1] ?? "", "aria-current") === "page",
  );
  if (navs.length !== 1 || current.length !== 1)
    throw new Error("Weber current native pagination missing or ambiguous");
  const page = Number(weberbrothersText(current[0]?.[2] ?? ""));
  const allLinks = anchors(nav);
  const links = allLinks
    .filter((link) => /^\d+$/.test(link.text))
    .map((link) => ({ page: Number(link.text), url: link.url }));
  const next = allLinks.filter((link) =>
    weberbrothersHasClass(link.tag, "next"),
  );
  const prev = allLinks.filter((link) =>
    weberbrothersHasClass(link.tag, "prev"),
  );
  if (
    next.length > 1 ||
    prev.length !== (page > 1 ? 1 : 0) ||
    (page > 1 && weberbrothersListingPage(prev[0]?.url ?? "") !== page - 1)
  )
    throw new Error("Weber native continuation is inconsistent");
  return WeberbrothersCatalogSchema.parse({
    url,
    page,
    lastPage: Math.max(page, ...links.map((link) => link.page)),
    next: next[0]?.url ?? null,
    links,
    posts,
    receipt: bodyReceipt(html),
  });
}
export function weberbrothersImageBound(raw: string, stock: string): boolean {
  if (!/^[A-Z0-9]+$/i.test(stock)) return false;
  const url = URL.parse(raw);
  if (
    !url ||
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.hash
  )
    return false;
  const direct =
    url.hostname === "weberbrothersauto.s3.amazonaws.com" && !url.search;
  const proxy =
    /^i[0-3]\.wp\.com$/.test(url.hostname) &&
    url.pathname.startsWith("/weberbrothersauto.s3.amazonaws.com/") &&
    [...url.searchParams.keys()].every(
      (key) => key === "fit" || key === "ssl" || key === "resize",
    );
  if (!direct && !proxy) return false;
  const path = proxy
    ? url.pathname.replace("/weberbrothersauto.s3.amazonaws.com", "")
    : url.pathname;
  if (!/^\/\d{4}\/\d{2}\/[a-z0-9_.-]+\.(?:jpe?g|png|webp)$/i.test(path))
    return false;
  const name = path.slice(path.lastIndexOf("/") + 1);
  return new RegExp(`(?:^|[-_])${stock}[-_](?:0|[1-9]\\d*)(?:[-_.])`, "i").test(
    name,
  );
}

export function parseWeberbrothersDetail(
  html: string,
  post: WeberbrothersPost,
): WeberbrothersRecord {
  WeberbrothersPostSchema.parse(post);
  const clean = weberbrothersDocument(html);
  // Native grouped donors contain component products below the donor summary.
  const product = weberbrothersOneDiv(clean, "product", true);
  if (
    inventoryHtmlAttribute(product.tag, "id") !==
      "product-" + post.nativePostId ||
    !weberbrothersHasClass(product.tag, "product_cat-vehicles") ||
    !weberbrothersHasClass(product.tag, "post-" + post.nativePostId)
  )
    throw new Error(
      "Weber detail native product ID or vehicle taxonomy changed",
    );
  const summary = weberbrothersOneDiv(product.body, "summary");
  const headings = [
    ...summary.body.matchAll(/(<h1\b[^>]*>)([\s\S]*?)<\/h1\s*>/gi),
  ].filter((match) => weberbrothersHasClass(match[1] ?? "", "product_title"));
  const heading = weberbrothersText(headings[0]?.[2] ?? "");
  const detailStock = optionalStock(summary.body, "Stock Number:");
  const stock = detailStock || post.stock;
  if (
    headings.length !== 1 ||
    heading !== post.title ||
    (detailStock && post.stock && detailStock !== post.stock)
  )
    throw new Error(
      "Weber listing/detail heading or stock changed during traversal",
    );
  const fields: Record<string, string> = {};
  let section = "";
  for (const attr of weberbrothersDivs(
    weberbrothersOneDiv(summary.body, "attr-box").body,
    "attr",
  )) {
    const text = weberbrothersText(attr.body);
    const split = /^([^:]+):\s*(.*)$/.exec(text);
    const label = split?.[1]?.trim();
    if (!label) throw new Error("Weber attribute lacks native label");
    const sub = weberbrothersHasClass(attr.tag, "sub");
    if (sub && !section)
      throw new Error("Weber nested attribute lacks native section");
    if (!sub)
      section = label === "Exterior" || label === "Interior" ? label : "";
    const key = sub ? section + " " + label : label;
    if (Object.hasOwn(fields, key))
      throw new Error("Duplicate Weber native field " + key);
    fields[key] = split?.[2] ?? "";
  }
  const gallery = weberbrothersOneDiv(
    product.body,
    "woocommerce-product-gallery",
  );
  const images = [...gallery.body.matchAll(/<img\b[^>]*>/gi)].flatMap(
    ([tag]) => {
      const src = inventoryHtmlAttribute(tag, "src");
      return src ? [weberbrothersText(src)] : [];
    },
  );
  return WeberbrothersRecordSchema.parse({
    post,
    heading,
    stock,
    fields,
    images: images
      .filter((image) => weberbrothersImageBound(image, stock))
      .slice(0, 1),
    receipt: bodyReceipt(html),
  });
}
