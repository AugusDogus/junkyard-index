import { createHash } from "node:crypto";
import { z } from "zod";
import {
  inventoryHtmlAttribute,
  stripInventoryRawText,
} from "./inventory-html";
import {
  BIGTRUCKPAGE_CATALOG_PATH,
  BIGTRUCKPAGE_ORIGIN,
  BIGTRUCKPAGE_SELLER_PATH,
  BIGTRUCKPAGE_YARD,
  bigtruckpageCatalogUrl,
} from "./bigtruckpage-yard-metadata";

export function isBigtruckpageDonorUrl(raw: string): boolean {
  const url = URL.parse(raw);
  return (
    url !== null &&
    url.origin === BIGTRUCKPAGE_ORIGIN &&
    !url.username &&
    !url.password &&
    !url.search &&
    !url.hash &&
    new RegExp(
      `^${BIGTRUCKPAGE_CATALOG_PATH}/[a-z0-9]+(?:-[a-z0-9]+)*-\\d{6}$`,
    ).test(url.pathname) &&
    url.href === raw
  );
}

export function isBigtruckpageImageUrl(raw: string): boolean {
  const url = URL.parse(raw);
  return (
    url !== null &&
    url.origin === "https://firebasestorage.googleapis.com" &&
    !url.username &&
    !url.password &&
    !url.hash &&
    /^\/v0\/b\/bigtruckpage\.firebasestorage\.app\/o\/trucks%2F[^/]+$/i.test(
      url.pathname,
    ) &&
    url.searchParams.get("alt") === "media" &&
    [...url.searchParams.keys()].every((key) =>
      ["alt", "token"].includes(key),
    ) &&
    [...url.searchParams.keys()].length ===
      new Set(url.searchParams.keys()).size
  );
}

export const BigtruckpageRecordSchema = z
  .object({
    url: z.string().max(1000).refine(isBigtruckpageDonorUrl),
    year: z.string().max(100),
    make: z.string().max(500),
    model: z.string().max(500),
    vin: z.string().max(100),
    label: z.string().max(1000),
    nativeTitle: z.string().max(1000).nullable(),
    imageUrl: z.string().max(2000).refine(isBigtruckpageImageUrl).nullable(),
  })
  .strict();
export type BigtruckpageRecord = z.infer<typeof BigtruckpageRecordSchema>;
export const BigtruckpageCatalogSchema = z
  .object({
    page: z.number().int().min(1).max(500),
    lastPage: z.number().int().min(1).max(500),
    total: z.number().int().min(1).max(10_000),
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    records: z.array(BigtruckpageRecordSchema).min(1).max(20),
  })
  .strict()
  .superRefine((catalog, context) => {
    if (
      catalog.lastPage !== Math.ceil(catalog.total / 20) ||
      catalog.page > catalog.lastPage ||
      catalog.records.length !==
        Math.min(20, catalog.total - (catalog.page - 1) * 20) ||
      new Set(catalog.records.map((record) => record.url)).size !==
        catalog.records.length
    )
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "BigTruckPage native page counts or donor URLs do not reconcile",
      });
  });
export type BigtruckpageCatalog = z.infer<typeof BigtruckpageCatalogSchema>;

const entities = new Map([
  ["amp", "&"],
  ["quot", '"'],
  ["apos", "'"],
  ["nbsp", " "],
  ["lt", "<"],
  ["gt", ">"],
  ["ndash", "\u2013"],
  ["mdash", "\u2014"],
  ["rsquo", "'"],
  ["lsquo", "'"],
  ["rdquo", '"'],
  ["ldquo", '"'],
]);
function text(raw: string): string {
  return raw
    .replace(/<!--[\s\S]*?-->|<[^>]*>/g, " ")
    .replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (entity: string, key: string) => {
      if (!key.startsWith("#")) {
        const decoded = entities.get(key.toLowerCase());
        if (decoded === undefined)
          throw new Error("Unsupported BigTruckPage entity " + entity);
        return decoded;
      }
      const hex = /^#x/i.test(key);
      const point = Number.parseInt(key.slice(hex ? 2 : 1), hex ? 16 : 10);
      if (
        point <= 0 ||
        point > 0x10ffff ||
        (point >= 0xd800 && point <= 0xdfff)
      )
        throw new Error("Invalid BigTruckPage character reference");
      return String.fromCodePoint(point);
    })
    .replace(/\s+/g, " ")
    .trim();
}
function href(tag: string): string | null {
  const raw = inventoryHtmlAttribute(tag, "href");
  if (raw === null) return null;
  const decoded = text(raw);
  // Accept literal root-relative native routes only, never repair external URLs.
  return decoded.startsWith("/") && !decoded.startsWith("//")
    ? BIGTRUCKPAGE_ORIGIN + decoded
    : decoded;
}
const anchors = (raw: string) => [
  ...raw.matchAll(/(<a\b[^>]*>)([\s\S]*?)<\/a>/gi),
];
function sellerLinks(raw: string): number {
  return anchors(raw).filter(
    (match) =>
      href(match[1] ?? "") === BIGTRUCKPAGE_ORIGIN + BIGTRUCKPAGE_SELLER_PATH &&
      text(match[2] ?? "") === BIGTRUCKPAGE_YARD.name,
  ).length;
}

function completeCard(main: string, start: number | undefined): string {
  if (start === undefined)
    throw new Error("BigTruckPage donor card position is missing");
  const remaining = main.slice(start);
  let depth = 0;
  for (const match of remaining.matchAll(/<\/?div\b[^>]*>/gi)) {
    depth += /^<\//.test(match[0]) ? -1 : 1;
    if (depth === 0) return remaining.slice(0, match.index + match[0].length);
  }
  throw new Error("BigTruckPage donor card is incomplete");
}

export function parseBigtruckpageCatalog(
  html: string,
  page: number,
): BigtruckpageCatalog {
  const clean = stripInventoryRawText(html);
  if (Buffer.byteLength(html) > 4 * 1024 * 1024 || !/<\/html>\s*$/i.test(clean))
    throw new Error("BigTruckPage document is oversized or truncated");
  // Keep React's explicit text-node boundaries. Removing them would merge
  // multiword native makes with their models.
  const rendered = html
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, (comment) =>
      comment === "<!-- -->" ? comment : "",
    );
  const mains = [...rendered.matchAll(/<main\b[^>]*>([\s\S]*?)<\/main>/gi)];
  const main = mains[0]?.[1];
  if (mains.length !== 1 || main === undefined || /<main\b/i.test(main))
    throw new Error("BigTruckPage main inventory is missing or incomplete");
  const headings = [...main.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)];
  if (
    headings.length !== 1 ||
    text(headings[0]?.[1] ?? "") !==
      "Dismantling trucks from " + BIGTRUCKPAGE_YARD.name ||
    sellerLinks(headings[0]?.[1] ?? "") !== 1 ||
    !text(main).includes(
      "Select a donor truck by make, model, or VIN. Click a listing to browse parts from that vehicle.",
    )
  )
    throw new Error(
      "BigTruckPage native seller or donor inventory scope changed",
    );

  const forms = [...main.matchAll(/(<form\b[^>]*>)([\s\S]*?)<\/form>/gi)];
  const filters = [
    ...(forms[0]?.[2] ?? "").matchAll(
      /<(?:input|select|textarea|button)\b[^>]*>/gi,
    ),
  ];
  if (
    forms.length !== 1 ||
    inventoryHtmlAttribute(forms[0]?.[1] ?? "", "method") !== "get" ||
    filters.filter(([tag]) => inventoryHtmlAttribute(tag, "name") !== null)
      .length !== 4 ||
    ![
      ["q", ""],
      ["vin", ""],
      ["make", "ALL"],
      ["model", "ALL"],
    ].every(([name, value]) => {
      const matches = filters.filter(
        ([tag]) => inventoryHtmlAttribute(tag, "name") === name,
      );
      return (
        matches.length === 1 &&
        inventoryHtmlAttribute(matches[0]?.[0] ?? "", "value") === value
      );
    })
  )
    throw new Error(
      "BigTruckPage catalog filters are missing, repeated or active; a filtered subset cannot establish complete inventory",
    );

  const totals = [
    ...main.matchAll(/<span\b[^>]*>(\d+)<!-- --> donor trucks<\/span>/g),
  ];
  const pagination = [
    ...main.matchAll(
      /<span\b[^>]*>Page <!-- -->(\d+)<!-- -->\/<!-- -->(\d+)<\/span>/g,
    ),
  ];
  const total = Number(totals[0]?.[1]);
  const lastPage = Number(pagination[0]?.[2]);
  if (
    totals.length !== 1 ||
    pagination.length !== 1 ||
    Number(pagination[0]?.[1]) !== page
  )
    throw new Error("BigTruckPage total or requested page is unverified");
  const selects = [
    ...main.matchAll(/(<select\b[^>]*>)([\s\S]*?)<\/select>/gi),
  ].filter(
    (match) =>
      inventoryHtmlAttribute(match[1] ?? "", "aria-label") === "Items per page",
  );
  if (
    selects.length !== 1 ||
    !/<option value="20" selected="">20<!-- --> \/ page<\/option>/.test(
      selects[0]?.[2] ?? "",
    )
  )
    throw new Error("BigTruckPage native 20-row page size changed");

  const openings = [...main.matchAll(/<div\b[^>]*>/gi)].filter(([tag]) =>
    inventoryHtmlAttribute(tag, "class")
      ?.split(/\s+/)
      .includes("if-steel-card"),
  );
  const records = openings.map((opening) => {
    const card = completeCard(main, opening.index);
    const cardLinks = anchors(card);
    const links = cardLinks.filter((match) =>
      inventoryHtmlAttribute(match[1] ?? "", "aria-label")?.startsWith(
        "Open donor truck:",
      ),
    );
    const link = links[0];
    const content = link?.[2] ?? "";
    const h3s = [...content.matchAll(/<h3\b[^>]*>([\s\S]*?)<\/h3>/gi)];
    const identity = /^(.*?)<!-- --> <!-- -->(.*?)$/.exec(h3s[0]?.[1] ?? "");
    if (
      links.length !== 1 ||
      h3s.length !== 1 ||
      !identity ||
      /<|>/.test((identity[1] ?? "") + (identity[2] ?? "")) ||
      /<a\b/i.test(content) ||
      cardLinks.length !== 2 ||
      sellerLinks(card) !== 1
    )
      throw new Error(
        "BigTruckPage donor card identity boundaries or seller ownership changed",
      );
    const years = [...content.matchAll(/<span\b[^>]*>(\d{4})<\/span>/gi)];
    const vins = [...content.matchAll(/<p\b[^>]*>VIN <!-- -->([^<]*)<\/p>/gi)];
    const images = [...content.matchAll(/<img\b[^>]*>/gi)];
    if (years.length !== 1 || vins.length !== 1 || images.length > 1)
      throw new Error(
        "BigTruckPage native donor scalars are missing or repeated",
      );
    const image = images[0]?.[0];
    const imageUrl = image
      ? text(inventoryHtmlAttribute(image, "src") ?? "")
      : "";
    const nativeTitle = image
      ? text(inventoryHtmlAttribute(image, "alt") ?? "")
      : "";
    return BigtruckpageRecordSchema.parse({
      url: href(link?.[1] ?? ""),
      year: text(years[0]?.[1] ?? ""),
      make: text(identity[1] ?? ""),
      model: text(identity[2] ?? ""),
      vin: text(vins[0]?.[1] ?? ""),
      label: text(inventoryHtmlAttribute(link?.[1] ?? "", "aria-label") ?? ""),
      nativeTitle: nativeTitle || null,
      imageUrl: imageUrl && isBigtruckpageImageUrl(imageUrl) ? imageUrl : null,
    });
  });
  const donorLinks = anchors(main).filter((match) => {
    const url = URL.parse(href(match[1] ?? "") ?? "");
    return url?.pathname.startsWith(BIGTRUCKPAGE_CATALOG_PATH + "/");
  });
  if (
    donorLinks.length !== records.length ||
    [...main.matchAll(/<h3\b/gi)].length !== records.length
  )
    throw new Error("BigTruckPage donor cards or URLs are incomplete");
  const pageLinks = anchors(main).filter((match) => {
    const url = URL.parse(href(match[1] ?? "") ?? "");
    return (
      url?.pathname === BIGTRUCKPAGE_CATALOG_PATH &&
      text(match[2] ?? "") !== "Reset"
    );
  });
  if (
    pageLinks.length !== lastPage ||
    pageLinks.some(
      (match, index) =>
        href(match[1] ?? "") !== bigtruckpageCatalogUrl(index + 1) ||
        text(match[2] ?? "") !== String(index + 1) ||
        (inventoryHtmlAttribute(match[1] ?? "", "class")
          ?.split(/\s+/)
          .includes("if-molten") ?? false) !==
          (index + 1 === page),
    )
  )
    throw new Error(
      "BigTruckPage native pagination is not a contiguous terminal graph",
    );
  return BigtruckpageCatalogSchema.parse({
    page,
    lastPage,
    total,
    records,
    fingerprint: createHash("sha256").update(html).digest("hex"),
  });
}
