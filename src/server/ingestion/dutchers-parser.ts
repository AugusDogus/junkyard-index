import { z } from "zod";
import { inventoryHtmlAttribute } from "./inventory-html";
import {
  dutchersAnchors,
  dutchersDivs,
  dutchersDocument,
  dutchersText,
} from "./dutchers-html";
import {
  DUTCHERS_MAX_PAGES,
  DUTCHERS_ORIGIN,
  DUTCHERS_PAGE_SIZE,
  dutchersCatalogUrl,
  type DutchersDirection,
} from "./dutchers-yard-metadata";

export function dutchersItemId(raw: string): string | null {
  return (
    /^https:\/\/www\.heavytruckparts\.net\/item\/[A-Za-z0-9%()_-]+\/[A-Za-z0-9%()_-]+\/Complete-Vehicle\/3987345\/1\/([1-9]\d{0,9})$/.exec(
      raw,
    )?.[1] ?? null
  );
}
function boundImage(raw: string, id: string): boolean {
  return new RegExp(
    `^https://webp\\.heavytruckparts\\.net/image/[A-Za-z0-9%()_-]+_Complete-Vehicle_3987345_1_${id}_1\\.webp$`,
    "i",
  ).test(raw);
}
export const DutchersRecordSchema = z
  .object({
    id: z.string().regex(/^[1-9]\d{0,9}$/),
    url: z
      .string()
      .max(1000)
      .refine((url) => dutchersItemId(url) !== null),
    year: z.string().max(10),
    make: z.string().max(200),
    model: z.string().max(300),
    vin: z.string().max(100),
    description: z.string().max(2000),
    imageUrl: z.string().max(2000).nullable(),
  })
  .strict()
  .refine(
    (r) =>
      dutchersItemId(r.url) === r.id &&
      (r.imageUrl === null || boundImage(r.imageUrl, r.id)),
    "Dutcher native item or photo join changed",
  );
export type DutchersRecord = z.infer<typeof DutchersRecordSchema>;
export const DutchersPageSchema = z
  .object({
    direction: z.enum(["DESC", "ASC"]),
    page: z.number().int().min(1).max(DUTCHERS_MAX_PAGES),
    records: z.array(DutchersRecordSchema).min(1).max(DUTCHERS_PAGE_SIZE),
  })
  .strict();
export type DutchersPage = z.infer<typeof DutchersPageSchema>;

export function parseDutchersCatalog(
  raw: string,
  direction: DutchersDirection,
  page: number,
  total: number,
): DutchersPage {
  const html = dutchersDocument(raw),
    last = Math.ceil(total / DUTCHERS_PAGE_SIZE);
  if (
    !Number.isSafeInteger(total) ||
    total < 1 ||
    last > DUTCHERS_MAX_PAGES ||
    page < 1 ||
    page > last
  )
    throw new Error(
      "Dutcher catalog page or store total is outside the native bound",
    );
  const regions = dutchersDivs(html, "search_result_div"),
    region = regions[0];
  if (regions.length !== 1 || region === undefined)
    throw new Error("Dutcher native inventory region is absent or repeated");
  const links = dutchersAnchors(region);
  for (const [label, expected] of [
    ["Next", page < last ? dutchersCatalogUrl(direction, page + 1) : null],
    ["Last", page < last ? dutchersCatalogUrl(direction, last) : null],
  ] as const) {
    const urls = new Set(
      links.filter((a) => a.text === label).map((a) => a.href),
    );
    if (
      expected === null
        ? urls.size !== 0
        : urls.size !== 1 || !urls.has(expected)
    )
      throw new Error(
        "Dutcher published " +
          label +
          " pagination differs from the store total or selected year order",
      );
  }
  const records = dutchersDivs(region, "product").map(
    (card): DutchersRecord => {
      const destinations = new Set(
        dutchersAnchors(card)
          .filter((a) => a.href.includes("/item/"))
          .map((a) => a.href),
      );
      const path = [...destinations][0] ?? "",
        url = DUTCHERS_ORIGIN + path;
      const id = dutchersItemId(url);
      if (destinations.size !== 1 || !path.startsWith("/item/") || id === null)
        throw new Error(
          "Dutcher card has a foreign owner/category or conflicting destination",
        );
      const headings = [...card.matchAll(/<h3\b[^>]*>([\s\S]*?)<\/h3>/gi)];
      const title = dutchersText(headings[0]?.[1] ?? "");
      const year = /^(\d{4}) /.exec(title)?.[1] ?? "";
      const controls = [...card.matchAll(/<button\b[^>]*>/gi)].flatMap(
        ([tag]) => {
          const call = inventoryHtmlAttribute(tag, "onclick");
          return call?.startsWith("create_estimate(")
            ? [dutchersText(call)]
            : [];
        },
      );
      const claim =
        /^create_estimate\(3987345, (\d+), 1, 9000, '([^']*)', '([^']*)', 'empty'\)$/.exec(
          controls[0] ?? "",
        );
      const make = claim?.[2]?.trim() ?? "",
        model = claim?.[3]?.trim() ?? "";
      if (
        headings.length !== 1 ||
        controls.length !== 1 ||
        claim?.[1] !== id ||
        title !== `${year} ${make} ${model} Complete Vehicle`
      )
        throw new Error(
          "Dutcher native title, item ID and make/model control do not join",
        );
      const attrs = [
        ...card.matchAll(/(<span\b[^>]*>)([\s\S]*?)<\/span>/gi),
      ].filter(
        (m) => inventoryHtmlAttribute(m[1] ?? "", "class") === "prod-attrib",
      );
      const attrText = dutchersText(attrs[0]?.[2] ?? "");
      if (attrs.length !== 1 || !attrText.startsWith("VIN #:"))
        throw new Error("Dutcher native VIN field is missing or ambiguous");
      const paragraphs = [
        ...card.matchAll(/(<p\b[^>]*>)([\s\S]*?)<\/p>/gi),
      ].map((p) => ({ tag: p[1] ?? "", text: dutchersText(p[2] ?? "") }));
      const location = paragraphs.filter(
        (p) => inventoryHtmlAttribute(p.tag, "class") === "location",
      );
      if (
        location.length !== 1 ||
        location[0]?.text !==
          "Sold by: Dutchers Inc Heavy Truck Div NY Location: MORRISVILLE NY"
      )
        throw new Error("Dutcher card physical owner or geography changed");
      const description = paragraphs
        .filter(
          (p) =>
            inventoryHtmlAttribute(p.tag, "class") === null &&
            !p.text.startsWith("VIN #:"),
        )
        .map((p) => p.text)
        .filter(Boolean)
        .join(" ");
      const image = [...card.matchAll(/<img\b[^>]*>/gi)][0]?.[0] ?? "";
      const imageUrl = inventoryHtmlAttribute(image, "src");
      const acceptedImage =
        imageUrl && boundImage(imageUrl, id) ? imageUrl : null;
      return DutchersRecordSchema.parse({
        id,
        url,
        year,
        make,
        model,
        vin: attrText.slice("VIN #:".length).trim(),
        description,
        imageUrl: acceptedImage,
      });
    },
  );
  if (
    records.length !==
      Math.min(DUTCHERS_PAGE_SIZE, total - (page - 1) * DUTCHERS_PAGE_SIZE) ||
    new Set(records.map((r) => r.id)).size !== records.length
  )
    throw new Error(
      "Dutcher native page size or within-page item uniqueness does not reconcile",
    );
  return DutchersPageSchema.parse({ direction, page, records });
}
