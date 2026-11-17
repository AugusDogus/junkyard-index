import {
  hollanderstoresBodyLimit,
  HOLLANDERSTORES_MAX_YARD_ROWS,
} from "./hollanderstores-limits";
import { z } from "zod";
import { matchCanonicalMakePrefix } from "./normalization";
import { beaversClass, beaversElements, beaversText } from "./beavers-html";
import {
  inventoryHtmlAttribute,
  stripInventoryRawText,
} from "./inventory-html";
import {
  HOLLANDERSTORES_YARDS,
  hollanderstoresDestination,
  hollanderstoresUsesPaging,
  type HollanderstoresYard,
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
    total: z.number().int().positive().max(HOLLANDERSTORES_MAX_YARD_ROWS),
    rows: z
      .array(HollanderstoresRowSchema)
      .min(1)
      .max(HOLLANDERSTORES_MAX_YARD_ROWS),
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

export function parseHollanderstoresRoster(
  raw: string,
  yard: HollanderstoresYard,
  pageNumber = 1,
) {
  if (!yard || Buffer.byteLength(raw) > hollanderstoresBodyLimit(yard.code))
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
  const total = Number(counts[0]?.[1]);
  if (hollanderstoresUsesPaging(yard)) {
    const tables = beaversElements(html, "table").filter(({ tag }) =>
      beaversClass(tag, "table"),
    );
    if (tables.length !== 1)
      throw new Error("Hollander Stores paged inventory table changed");
    const table = tables[0]?.body ?? "";
    const bodies = beaversElements(table, "tbody");
    const footers = beaversElements(table, "tfoot");
    if (bodies.length !== 1 || footers.length !== 1)
      throw new Error("Hollander Stores paging regions changed");
    const rows = beaversElements(bodies[0]?.body ?? "", "tr").map(
      ({ body }) => {
        const cells = beaversElements(body, "td");
        const links = beaversElements(cells[7]?.body ?? "", "a");
        if (cells.length !== 8 || links.length !== 1)
          throw new Error("Hollander Stores list columns changed");
        return {
          displayYear: beaversText(cells[0]?.body ?? ""),
          // This view has no make column. Decode only valid VINs, never infer from its model code.
          make: null,
          model: beaversText(cells[1]?.body ?? ""),
          stock: beaversText(cells[2]?.body ?? ""),
          vin: beaversText(cells[5]?.body ?? ""),
          url: new URL(
            inventoryHtmlAttribute(links[0]?.tag ?? "", "href") ?? "",
            yard.websiteUrl,
          ).href,
        };
      },
    );
    const last = Math.ceil(total / 20);
    const footer = footers[0]?.body ?? "";
    const current = beaversText(
      footer.replace(/<a\b[^>]*>[\s\S]*?<\/a\s*>/gi, ""),
    );
    const destinations = beaversElements(footer, "a").map(({ tag }) =>
      inventoryHtmlAttribute(tag, "href"),
    );
    if (
      !Number.isSafeInteger(pageNumber) ||
      pageNumber < 1 ||
      pageNumber > last ||
      current !== String(pageNumber) ||
      rows.length !== Math.min(20, total - (pageNumber - 1) * 20) ||
      destinations.some(
        (href) =>
          !href ||
          !/^\/VehicleDealerSearch\?page=[1-9][0-9]*$/.test(href) ||
          Number(href.split("=")[1]) > last,
      ) ||
      (pageNumber < last &&
        !destinations.includes(
          `/VehicleDealerSearch?page=${pageNumber + 1}`,
        )) ||
      (pageNumber === last &&
        destinations.some((href) => Number(href?.split("=")[1]) > pageNumber))
    )
      throw new Error(
        "Hollander Stores list page position, count or next destination changed",
      );
    return validateRoster(
      yard,
      total,
      rows,
      pageNumber < last ? pageNumber + 1 : null,
    );
  }
  if (pageNumber !== 1)
    throw new Error("Hollander Stores card view cannot be paged");
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
    const blankMake = remainder.startsWith(" ");
    const fields = blankMake
      ? null
      : matchCanonicalMakePrefix(beaversText(remainder));
    if (!match) throw new Error("Hollander Stores make/model fields changed");
    // Unknown prefixes remain row rejects, rather than guessing at the first word.
    const text = beaversText(remainder);
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
      make: fields ? text.slice(0, fields.end).trim() : null,
      model: fields ? text.slice(fields.end).trim() : blankMake ? text : "",
      vin: field("VIN "),
      stock: field("Stock# "),
      url: new URL(
        inventoryHtmlAttribute(links[0]?.tag ?? "", "href") ?? "",
        yard.websiteUrl,
      ).href,
    };
  });
  return validateRoster(yard, total, rows, null);
}

function validateRoster(
  yard: HollanderstoresYard,
  total: number,
  input: unknown,
  nextPage: number | null,
) {
  const rows = z
    .array(HollanderstoresRowSchema)
    .min(1)
    .max(HOLLANDERSTORES_MAX_YARD_ROWS)
    .parse(input);
  if (
    !Number.isSafeInteger(total) ||
    total < 1 ||
    total > HOLLANDERSTORES_MAX_YARD_ROWS ||
    (!hollanderstoresUsesPaging(yard) && rows.length !== total) ||
    rows.some((row) => !hollanderstoresDestination(row.url, yard)) ||
    new Set(rows.map((row) => row.url)).size !== rows.length
  )
    throw new Error(
      "Hollander Stores count or tenant destinations do not reconcile",
    );
  return { yard: yard.code, total, rows, nextPage };
}

export function parseHollanderstoresPage(
  raw: string,
  yardIndex: number,
): HollanderstoresPage {
  const yard = HOLLANDERSTORES_YARDS[yardIndex];
  if (!yard) throw new Error("Hollander Stores tenant changed");
  const { nextPage, ...page } = parseHollanderstoresRoster(raw, yard);
  if (nextPage !== null)
    throw new Error("Hollander Stores roster needs more list pages");
  return HollanderstoresPageSchema.parse(page);
}
