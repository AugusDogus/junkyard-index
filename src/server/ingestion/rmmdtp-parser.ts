import { createHash } from "node:crypto";
import { z } from "zod";
import { stripInventoryRawText } from "./inventory-html";
import {
  RMMDTP_MAX_BODY_BYTES,
  RMMDTP_ORIGIN,
  rmmdtpAttribute as attr,
  rmmdtpDetailUrl,
  rmmdtpDivs,
  rmmdtpHasClass as hasClass,
  rmmdtpPageUrl,
  rmmdtpText as text,
} from "./rmmdtp-html";
import { RmmdtpRecordSchema, type RmmdtpRecord } from "./rmmdtp-record";

export const rmmdtpHash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
export const RmmdtpPageSchema = z
  .object({
    page: z.number().int().min(1).max(400),
    total: z.number().int().min(1).max(10_000),
    salvageTotal: z.number().int().nonnegative(),
    completeTotal: z.number().int().nonnegative(),
    lastPage: z.number().int().min(1).max(400),
    nextUrl: z.string().max(1000).nullable(),
    records: z.array(RmmdtpRecordSchema).min(1).max(25),
    hash: z.string().regex(/^[a-f0-9]{64}$/),
    bodyBytes: z.number().int().positive().max(RMMDTP_MAX_BODY_BYTES),
  })
  .strict();
export type RmmdtpPage = z.infer<typeof RmmdtpPageSchema>;
export const rmmdtpPageHash = (page: Omit<RmmdtpPage, "hash" | "bodyBytes">) =>
  rmmdtpHash({
    page: page.page,
    total: page.total,
    salvageTotal: page.salvageTotal,
    completeTotal: page.completeTotal,
    lastPage: page.lastPage,
    nextUrl: page.nextUrl,
    records: page.records,
  });

function parseCard(html: string): RmmdtpRecord {
  const anchors = [...html.matchAll(/<a\b[^>]*>/gi)].map(([tag]) => {
    const raw = attr(tag, "href");
    const destination = raw === null ? null : rmmdtpDetailUrl(raw);
    if (destination === null)
      throw new Error(
        "Native donor link left its owned truck-description destination",
      );
    return destination;
  });
  const detailsUrl = anchors[0];
  if (
    anchors.length !== 3 ||
    !detailsUrl ||
    anchors.some((value) => value !== detailsUrl)
  )
    throw new Error(
      "Native card must publish three identical owned donor links",
    );
  const headings = [...html.matchAll(/<h2\b[^>]*>([\s\S]*?)<\/h2>/gi)];
  if (headings.length !== 1)
    throw new Error("Native donor title is missing or ambiguous");
  const fields: Record<string, string> = {};
  const labels = [...html.matchAll(/<h6\b[^>]*>([\s\S]*?)<\/h6>/gi)].filter(
    (match) => /:\s*$/.test(text(match[1] ?? "")),
  );
  for (const pair of html.matchAll(
    /<div\b[^>]*>\s*<h6\b[^>]*>((?:(?!<\/h6\b)[\s\S])*)<\/h6>\s*<\/div>\s*<div\b[^>]*>([\s\S]*?)<\/div>/gi,
  )) {
    const label = text(pair[1] ?? "").replace(/\s*:\s*$/, "");
    if (Object.hasOwn(fields, label))
      throw new Error("Repeated native truck field " + label);
    fields[label] = text(pair[2] ?? "");
  }
  if (
    Object.keys(fields).length !== labels.length ||
    !Object.hasOwn(fields, "Condition")
  )
    throw new Error("Native labeled truck fields are incomplete or ambiguous");
  if (fields.Condition !== "Salvage" && fields.Condition !== "Complete")
    throw new Error(
      "Native condition is outside the qualified Salvage/Complete scope",
    );
  const images = [...html.matchAll(/<img\b[^>]*>/gi)];
  if (images.length > 1)
    throw new Error("Native card has ambiguous image claims");
  return RmmdtpRecordSchema.parse({
    id: new URL(detailsUrl).searchParams.get("truck"),
    title: text(headings[0]?.[1] ?? ""),
    detailsUrl,
    detailAnchors: anchors,
    imageUrl: images[0] ? attr(images[0][0], "data-src") : null,
    fields,
  });
}

export function parseRmmdtpPage(
  raw: string,
  requestedPage: number,
): RmmdtpPage {
  if (
    !Number.isSafeInteger(requestedPage) ||
    requestedPage < 1 ||
    requestedPage > 400 ||
    Buffer.byteLength(raw) > RMMDTP_MAX_BODY_BYTES ||
    !/<\/html\s*>\s*$/i.test(raw)
  )
    throw new Error(
      "Native page range, 2 MiB budget or complete HTML boundary is invalid",
    );
  const html = stripInventoryRawText(raw);
  const title = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? "";
  const plain = text(html);
  if (
    !text(title).includes("Rocky Mountain Medium Duty Truck Parts") ||
    !plain.includes("2715 North Mule Ranch Circle, Corinne, Utah") ||
    !plain.includes("801-781-1015")
  )
    throw new Error("Native page lost its qualified Corinne operator identity");
  const addresses = [
    ...rmmdtpDivs(html, (tag) => hasClass(tag, "tpi_theme_address1")).map(text),
    ...[...html.matchAll(/<p\b([^>]*)>([\s\S]*?)<\/p>/gi)]
      .filter((match) => hasClass(match[1] ?? "", "tpi_theme_address1"))
      .map((match) => text(match[2] ?? "")),
  ];
  if (
    addresses.length !== 2 ||
    addresses.some(
      (address) => address !== "2715 North Mule Ranch Circle, Corinne, Utah",
    )
  )
    throw new Error(
      "Native contact addresses contradict the qualified Corinne location",
    );
  const filters = rmmdtpDivs(
    html,
    (tag) => attr(tag, "id") === "truck-filters",
  );
  const filter = filters[0];
  if (filters.length !== 1 || filter === undefined)
    throw new Error("Native current-filter boundary is missing or ambiguous");
  const options = [...filter.matchAll(/<div\b[^>]*>/gi)].find(([tag]) =>
    hasClass(tag, "well"),
  );
  const current = options === undefined ? null : filter.slice(0, options.index);
  const selections =
    current === null
      ? []
      : rmmdtpDivs(current, (tag) => hasClass(tag, "filter-list"));
  if (
    current === null ||
    selections.length !== 1 ||
    text(selections[0] ?? "") !== "" ||
    !["", "Current Filters RESET"].includes(text(current))
  )
    throw new Error(
      "Additional active native filters cannot establish the complete unfiltered inventory",
    );
  const conditions = rmmdtpDivs(
    html,
    (tag) => attr(tag, "id") === "conditionFilter",
  );
  const condition = conditions[0];
  if (conditions.length !== 1 || condition === undefined)
    throw new Error("Native condition census is missing or ambiguous");
  const facets = [...condition.matchAll(/(<a\b[^>]*>)([\s\S]*?)<\/a>/gi)].map(
    (match) => ({
      label: text(match[2] ?? ""),
      href: attr(match[1] ?? "", "href"),
    }),
  );
  const salvage = facets.find((facet) => /^Salvage \d+$/.test(facet.label));
  const complete = facets.find((facet) => /^Complete \d+$/.test(facet.label));
  const facetBase =
    RMMDTP_ORIGIN +
    "/trucks/?" +
    (requestedPage === 1 ? "" : `page_number=${requestedPage}&`);
  if (
    facets.length !== 2 ||
    salvage?.href !== facetBase + "f-condition=nw" ||
    complete?.href !== facetBase + "f-condition=c"
  )
    throw new Error("Native unfiltered condition census changed");
  const salvageTotal = Number(salvage.label.split(" ")[1]),
    completeTotal = Number(complete.label.split(" ")[1]);
  const pagers = [...html.matchAll(/<ul\b([^>]*)>([\s\S]*?)<\/ul>/gi)].filter(
    (match) => hasClass(match[1] ?? "", "pagination"),
  );
  if (pagers.length !== 2)
    throw new Error("Expected both native pagination controls");
  let total = 0,
    lastPage = 0;
  const nextUrls: (string | null)[] = [];
  for (const pager of pagers) {
    const markup = pager[2] ?? "";
    const ranges = [
      ...markup.matchAll(/<span\b([^>]*)>([\s\S]*?)<\/span>/gi),
    ].filter((match) => hasClass(match[1] ?? "", "pagination-info"));
    const range = /^(\d+)-(\d+) of (\d+)$/.exec(text(ranges[0]?.[2] ?? ""));
    const count = Number(range?.[3]);
    if (
      ranges.length !== 1 ||
      !range ||
      count !== salvageTotal + completeTotal ||
      Number(range[1]) !== (requestedPage - 1) * 25 + 1 ||
      Number(range[2]) !== Math.min(requestedPage * 25, count)
    )
      throw new Error(
        "Native header/footer ranges contradict the condition census or requested page",
      );
    total = count;
    lastPage = Math.ceil(count / 25);
    const active = [
      ...markup.matchAll(/<li\b([^>]*)>([\s\S]*?)<\/li>/gi),
    ].filter((match) => hasClass(match[1] ?? "", "active"));
    if (
      active.length !== 1 ||
      text(active[0]?.[2] ?? "") !== String(requestedPage)
    )
      throw new Error("Native active page differs from its requested page");
    const next: string[] = [],
      last: string[] = [];
    for (const anchor of markup.matchAll(/(<a\b[^>]*>)([\s\S]*?)<\/a>/gi)) {
      const label = text(anchor[2] ?? "");
      if (label !== "Next Page" && label !== "Last Page") continue;
      const rawHref = attr(anchor[1] ?? "", "href");
      const url =
        rawHref === null
          ? null
          : rmmdtpPageUrl(
              rawHref,
              label === "Next Page" ? requestedPage + 1 : lastPage,
            );
      if (url === null)
        throw new Error("Native pagination left the owned unfiltered graph");
      (label === "Next Page" ? next : last).push(url);
    }
    const expected = requestedPage < lastPage ? 1 : 0;
    if (next.length !== expected || last.length !== expected)
      throw new Error(
        "Native Next/Last controls do not prove terminal traversal",
      );
    nextUrls.push(next[0] ?? null);
  }
  if (nextUrls[0] !== nextUrls[1])
    throw new Error("Native pagination destinations disagree");
  const records = rmmdtpDivs(html, (tag) => hasClass(tag, "list-item")).map(
    parseCard,
  );
  if (records.length !== Math.min(25, total - (requestedPage - 1) * 25))
    throw new Error("Native card count contradicts pagination");
  const page = {
    page: requestedPage,
    total,
    salvageTotal,
    completeTotal,
    lastPage,
    nextUrl: nextUrls[0] ?? null,
    records,
  };
  return RmmdtpPageSchema.parse({
    ...page,
    hash: rmmdtpPageHash(page),
    bodyBytes: Buffer.byteLength(raw),
  });
}
