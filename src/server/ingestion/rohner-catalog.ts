import { createHash } from "node:crypto";
import { z } from "zod";
import { inventoryHtmlAttribute } from "./inventory-html";
import {
  rohnerClass,
  rohnerDecode,
  rohnerDocument,
  rohnerRegions,
  rohnerText,
  ROHNER_MAX_BODY_BYTES,
} from "./rohner-html";
import { isRohnerArticleUrl, RohnerCardSchema } from "./rohner-record";

export const ROHNER_MAX_PAGES = 32;
export const ROHNER_MAX_DONORS = ROHNER_MAX_PAGES * 24;
export const ROHNER_MAX_RESPONSE_BYTES = ROHNER_MAX_BODY_BYTES;
export const rohnerHash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

export function rohnerCatalogPage(raw: string): number | null {
  const url = URL.parse(raw);
  if (
    !url ||
    url.href !== raw ||
    url.origin !== "https://rohnersautoparts.com" ||
    url.username ||
    url.password ||
    url.hash ||
    url.search !== "?product-categories=vehicles"
  )
    return null;
  if (url.pathname === "/shop/") return 1;
  const match = /^\/shop\/page\/([1-9]\d*)\/$/.exec(url.pathname);
  const page = Number(match?.[1]);
  return match && page >= 2 && page <= ROHNER_MAX_PAGES ? page : null;
}

export const RohnerPostSchema = z.object({
  url: z.string().refine(isRohnerArticleUrl),
  card: RohnerCardSchema,
});
export type RohnerPost = z.infer<typeof RohnerPostSchema>;
export const RohnerCatalogSchema = z
  .object({
    url: z.string().refine((raw) => rohnerCatalogPage(raw) !== null),
    page: z.number().int().min(1).max(ROHNER_MAX_PAGES),
    lastPage: z.number().int().min(1).max(ROHNER_MAX_PAGES),
    range: z.object({
      first: z.number().int().positive(),
      last: z.number().int().positive(),
      total: z.number().int().positive().max(ROHNER_MAX_DONORS),
    }),
    links: z
      .array(
        z.object({
          text: z.string(),
          href: z.string().refine((raw) => rohnerCatalogPage(raw) !== null),
        }),
      )
      .max(ROHNER_MAX_PAGES + 2),
    posts: z.array(RohnerPostSchema).min(1).max(24),
    hash: z.string().regex(/^[a-f0-9]{64}$/),
    receipt: z.object({
      bytes: z.number().int().positive().max(ROHNER_MAX_RESPONSE_BYTES),
      sha256: z.string().regex(/^[a-f0-9]{64}$/),
    }),
  })
  .superRefine((catalog, context) => {
    if (
      rohnerCatalogPage(catalog.url) !== catalog.page ||
      catalog.range.first !== (catalog.page - 1) * 24 + 1 ||
      catalog.range.last !== Math.min(catalog.page * 24, catalog.range.total) ||
      catalog.range.last - catalog.range.first + 1 !== catalog.posts.length ||
      catalog.lastPage !== Math.ceil(catalog.range.total / 24) ||
      catalog.page > catalog.lastPage ||
      new Set(catalog.posts.map((post) => post.url)).size !==
        catalog.posts.length ||
      catalog.posts.some(
        (post) =>
          post.card.destinationOccurrences.length === 0 ||
          post.card.destinationOccurrences.some(
            (link) => link.href !== post.url,
          ),
      ) ||
      catalog.hash !== rohnerHash(rohnerCatalogMembership(catalog))
    )
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Rohner native result range, card destinations or page membership does not reconcile",
      });
  });
export type RohnerCatalog = z.infer<typeof RohnerCatalogSchema>;

export function rohnerCatalogMembership(catalog: {
  url: string;
  page: number;
  lastPage: number;
  range: { first: number; last: number; total: number };
  links: { text: string; href: string }[];
  posts: RohnerPost[];
}) {
  return {
    url: catalog.url,
    page: catalog.page,
    lastPage: catalog.lastPage,
    range: catalog.range,
    links: catalog.links,
    posts: catalog.posts.map((post) => ({
      url: post.url,
      card: {
        id: post.card.id,
        classes: post.card.classes
          .filter((value) =>
            /^(?:post-\d+|status-|instock$|outofstock$|product_cat-)/.test(
              value,
            ),
          )
          .sort(),
        titles: post.card.titles,
        destinationOccurrences: post.card.destinationOccurrences,
        imageClaims: post.card.imageOccurrences.map((image) => ({
          alt: image.alt ?? "",
          title: image.title ?? "",
        })),
      },
    })),
  };
}

export function parseRohnerCatalog(raw: string, url: string): RohnerCatalog {
  const page = rohnerCatalogPage(url);
  if (page === null)
    throw new Error(
      "Rohner catalog URL is outside the published filtered Vehicles directory",
    );
  const html = rohnerDocument(raw);
  const lists = rohnerRegions(html, "ul", (tag) =>
    rohnerClass(tag, "products"),
  );
  const counts = rohnerRegions(html, "p", (tag) =>
    rohnerClass(tag, "woocommerce-result-count"),
  );
  const navigation = rohnerRegions(html, "nav", (tag) =>
    rohnerClass(tag, "woocommerce-pagination"),
  );
  if (lists.length !== 1 || counts.length !== 1 || navigation.length !== 1)
    throw new Error(
      "Rohner native Vehicles cards, result count or pagination is missing or ambiguous",
    );
  const range = /^Showing\s+(\d+)[\u2013-](\d+)\s+of\s+(\d+)\s+results\b/.exec(
    rohnerText(counts[0]?.body ?? ""),
  );
  if (!range)
    throw new Error(
      "Rohner published result range changed; preserve the response before continuing",
    );
  const posts = rohnerRegions(lists[0]?.body ?? "", "li", (tag) =>
    rohnerClass(tag, "product"),
  ).map((node, index) => {
    if (!rohnerClass(node.tag, "product_cat-vehicles"))
      throw new Error(
        "Rohner filtered directory includes a card outside Vehicles",
      );
    const destinationOccurrences = rohnerRegions(
      node.body,
      "a",
      () => true,
    ).map((anchor) => ({
      text: rohnerText(anchor.body),
      href: rohnerDecode(inventoryHtmlAttribute(anchor.tag, "href") ?? ""),
      title: inventoryHtmlAttribute(anchor.tag, "title"),
    }));
    const destinations = [
      ...new Set(destinationOccurrences.map((link) => link.href)),
    ];
    const destination = destinations[0];
    if (
      destinations.length !== 1 ||
      !destination ||
      !isRohnerArticleUrl(destination)
    )
      throw new Error(
        "Rohner card destinations are missing, foreign or conflicting",
      );
    const imageOccurrences = [...node.body.matchAll(/<img\b[^>]*>/gi)].map(
      ([tag]) => {
        const image: Record<string, string> = {};
        for (const key of ["alt", "title", "src", "srcset", "data-src"]) {
          const value = inventoryHtmlAttribute(tag, key);
          if (value !== null) image[key] = rohnerDecode(value);
        }
        return image;
      },
    );
    return {
      url: destination,
      card: {
        id: `page${String(page).padStart(2, "0")}-card${String(index + 1).padStart(2, "0")}`,
        classes: (inventoryHtmlAttribute(node.tag, "class") ?? "").split(/\s+/),
        titles: rohnerRegions(node.body, "h2", (tag) =>
          rohnerClass(tag, "woocommerce-loop-product__title"),
        ).map((title) => rohnerText(title.body)),
        destinationOccurrences,
        imageOccurrences,
      },
    };
  });
  const nav = navigation[0]?.body ?? "";
  const current = rohnerRegions(
    nav,
    "span",
    (tag) => inventoryHtmlAttribute(tag, "aria-current") === "page",
  );
  if (
    current.length !== 1 ||
    rohnerText(current[0]?.body ?? "") !== String(page)
  )
    throw new Error("Rohner directory ignored the requested native page");
  const links = rohnerRegions(nav, "a", () => true).map((anchor) => ({
    text: rohnerText(anchor.body),
    href: rohnerDecode(inventoryHtmlAttribute(anchor.tag, "href") ?? ""),
  }));
  const lastPage = Math.ceil(Number(range[3]) / 24);
  for (const link of links) {
    const number = rohnerCatalogPage(link.href);
    if (
      number === null ||
      number > lastPage ||
      (/^\d+$/.test(link.text)
        ? number !== Number(link.text)
        : !(
            (link.text === "→" && number === page + 1) ||
            (link.text === "←" && number === page - 1)
          ))
    )
      throw new Error(
        "Rohner pagination contains an unbound native continuation",
      );
  }
  if (
    links.filter((link) => link.text === "→").length !==
      Number(page < lastPage) ||
    links.filter((link) => link.text === "←").length !== Number(page > 1) ||
    (page < lastPage &&
      !links.some((link) => rohnerCatalogPage(link.href) === lastPage))
  )
    throw new Error(
      "Rohner pagination has no complete next/terminal directory proof",
    );
  const value = {
    url,
    page,
    lastPage,
    range: {
      first: Number(range[1]),
      last: Number(range[2]),
      total: Number(range[3]),
    },
    links,
    posts,
  };
  return RohnerCatalogSchema.parse({
    ...value,
    hash: rohnerHash(rohnerCatalogMembership(value)),
    receipt: {
      bytes: Buffer.byteLength(raw),
      sha256: createHash("sha256").update(raw).digest("hex"),
    },
  });
}
