import { z } from "zod";
import { beaversClass, beaversElements, beaversText } from "./beavers-html";
import {
  inventoryHtmlAttribute,
  stripInventoryRawText,
} from "./inventory-html";
import {
  HOLLANDERSTORES_YARDS,
  hollanderstoresDestination,
} from "./hollanderstores-yard-metadata";

export const HollanderstoresRowSchema = z
  .object({
    displayYear: z.string().regex(/^'\d{2}$/),
    make: z.string().max(100).nullable(),
    model: z.string().max(100),
    vin: z.string().max(100),
    stock: z.string().max(100),
    url: z.string().url(),
  })
  .strict();
export type HollanderstoresRow = z.infer<typeof HollanderstoresRowSchema>;
export const HollanderstoresPageSchema = z
  .object({
    yard: z.string(),
    total: z.number().int().positive().max(2000),
    rows: z.array(HollanderstoresRowSchema).min(1).max(2000),
  })
  .strict()
  .superRefine((page, ctx) => {
    const yard = HOLLANDERSTORES_YARDS.find((y) => y.code === page.yard);
    if (
      !yard ||
      page.rows.length !== page.total ||
      page.rows.some((row) => !hollanderstoresDestination(row.url, yard)) ||
      new Set(page.rows.map((row) => row.url)).size !== page.total
    )
      ctx.addIssue({
        code: "custom",
        message:
          "Hollander Stores complete count or tenant destinations do not reconcile",
      });
  });
export type HollanderstoresPage = z.infer<typeof HollanderstoresPageSchema>;

export function parseHollanderstoresPage(
  raw: string,
  yardIndex: number,
): HollanderstoresPage {
  const yard = HOLLANDERSTORES_YARDS[yardIndex];
  if (!yard || Buffer.byteLength(raw) > 4 * 1024 * 1024)
    throw new Error("Hollander Stores tenant or body bound changed");
  const html = stripInventoryRawText(raw);
  if (!/<\/html\s*>\s*$/i.test(html))
    throw new Error("Hollander Stores document is truncated");
  const logos = beaversElements(html, "a").filter(({ tag }) =>
    beaversClass(tag, "hpdcLogo"),
  );
  const counts = [
    ...beaversText(html).matchAll(/Showing (\d+) Vehicles in Inventory/g),
  ];
  if (
    logos.length !== 1 ||
    beaversText(logos[0]?.body ?? "") !== yard.logo ||
    counts.length !== 1
  )
    throw new Error(
      "Hollander Stores yard identity or published count changed",
    );
  const regions = html.split(/<div\b[^>]*class="individualPartHolder"[^>]*>/i);
  const rows = regions.slice(1).map((region) => {
    const headings = beaversElements(region, "span").filter(({ body }) =>
      /^&#39;\d{2} /.test(body.trim()),
    );
    if (headings.length !== 1)
      throw new Error("Hollander Stores card heading changed");
    // An empty native make occupies a blank field, before whitespace normalization.
    const heading = (headings[0]?.body ?? "").trim().replace(/^&#39;/, "'");
    const match = /^('\d{2}) (.*)$/.exec(heading);
    const remainder = match?.[2] ?? "";
    const fields = remainder.startsWith(" ")
      ? null
      : /^(AMERICAN MOTORS|LAND ROVER|ALFA ROMEO|[A-Z-]+)\s+(.+)$/.exec(
          remainder,
        );
    if (!match || (!remainder.startsWith(" ") && !fields))
      throw new Error("Hollander Stores make/model fields changed");
    const items = beaversElements(region, "li").map(({ body }) =>
      beaversText(body),
    );
    const field = (prefix: string) => {
      const values = items.filter((item) => item.startsWith(prefix));
      if (values.length !== 1)
        throw new Error("Hollander Stores card requires one " + prefix);
      return values[0]?.slice(prefix.length).trim() ?? "";
    };
    const links = beaversElements(region, "a").filter(({ tag }) =>
      (inventoryHtmlAttribute(tag, "href") ?? "").startsWith(
        "/VehicleDealerShowParts/",
      ),
    );
    if (links.length !== 1)
      throw new Error("Hollander Stores card destination changed");
    return {
      displayYear: match[1],
      make: fields?.[1] ?? null,
      model: beaversText(fields?.[2] ?? remainder),
      vin: field("VIN "),
      stock: field("Stock# "),
      url: new URL(
        inventoryHtmlAttribute(links[0]?.tag ?? "", "href") ?? "",
        yard.websiteUrl,
      ).href,
    };
  });
  return HollanderstoresPageSchema.parse({
    yard: yard.code,
    total: Number(counts[0]?.[1]),
    rows,
  });
}
