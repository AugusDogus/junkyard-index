import { createHash } from "node:crypto";
import { z } from "zod";
import { inventoryHtmlAttribute } from "./inventory-html";
import {
  scottsClass,
  scottsDivs,
  scottsDocument,
  scottsText,
} from "./scotts-html";
import {
  SCOTTS_IMAGE_PREFIX,
  SCOTTS_MAKES,
  SCOTTS_ORIGIN,
  scottsBrowsePath,
} from "./scotts-yard-metadata";

export const scottsHash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
export const ScottsControlSchema = z
  .object({
    path: z.string().min(1).max(300),
    label: z.string().min(1).max(100),
    count: z.number().int().min(0).max(20_000),
  })
  .strict();
export type ScottsControl = z.infer<typeof ScottsControlSchema>;
// Native VIN, labelled year/title/stock, literal donor href and primary image.
// Image references are compacted only against the literal CC68 image prefix.
export const ScottsRecordSchema = z.tuple([
  z.string().max(100),
  z.string().max(30),
  z.string().max(200),
  z.string().max(100),
  z.string().max(1000),
  z.string().max(1500).nullable(),
  z.string().max(100),
]);
export type ScottsRecord = z.infer<typeof ScottsRecordSchema>;
export const ScottsPageSchema = z
  .object({
    hash: z.string().regex(/^[a-f0-9]{64}$/),
    records: z.array(ScottsRecordSchema).max(1000),
  })
  .strict();
export type ScottsPage = z.infer<typeof ScottsPageSchema>;

const attribute = (tag: string, name: string) => {
  const value = inventoryHtmlAttribute(tag, name);
  return value === null ? null : scottsText(value);
};

function terminal(html: string) {
  for (const match of html.matchAll(/<(?:a|button|div|nav|ul|li)\b[^>]*>/gi)) {
    const tag = match[0];
    if (
      /paginat|page-numbers|page-link|load.?more/i.test(
        attribute(tag, "class") ?? "",
      ) ||
      /^(?:next|prev)$/i.test(attribute(tag, "rel") ?? "") ||
      ["data-page", "data-next", "data-cursor"].some(
        (name) => inventoryHtmlAttribute(tag, name) !== null,
      )
    )
      throw new Error(
        "Scotts native pagination changed; inspect the finite published graph before resuming",
      );
    const href = attribute(tag, "href");
    if (!href) continue;
    const url = URL.parse(href, SCOTTS_ORIGIN);
    if (
      url?.origin === SCOTTS_ORIGIN &&
      (/\/page\/\d+(?:\/|$)/i.test(url.pathname) ||
        [...url.searchParams.keys()].some((key) =>
          /^(?:page|paged|offset|cursor)$/i.test(key),
        ))
    )
      throw new Error("Scotts native numeric continuation is not classified");
  }
  for (const match of html.matchAll(
    /(<(?:a|button)\b[^>]*>)([\s\S]*?)<\/(?:a|button)>/gi,
  )) {
    const tag = match[1] ?? "";
    if (
      scottsClass(tag, "aps-gallery-carousel-control") &&
      attribute(tag, "data-bs-target") === "#apsPartsGalleryCarousel"
    )
      continue;
    const url = URL.parse(attribute(tag, "href") ?? "", SCOTTS_ORIGIN);
    if (
      /^\d+$/.test(scottsText(match[2] ?? "")) &&
      url?.origin === SCOTTS_ORIGIN &&
      (url.search || url.hash)
    )
      throw new Error("Scotts numeric browse continuation is not classified");
    if (
      /^(?:next(?: page)?|previous(?: page)?|load more|show more)$/i.test(
        scottsText(match[2] ?? ""),
      )
    )
      throw new Error("Scotts native continuation is not classified");
  }
}

function inventory(raw: string, checkContinuation = true) {
  const suppliers = [...raw.matchAll(/\bvar\s+urgid\s*=\s*(['"])(.*?)\1\s*;/g)];
  if (!suppliers.length || suppliers.some((match) => match[2] !== "CC68,XX00"))
    throw new Error(
      "Scotts native CC68,XX00 supplier declaration is missing or changed",
    );
  const html = scottsDocument(raw);
  if (checkContinuation) terminal(html);
  if (scottsDivs(html, "card-price").length)
    throw new Error("Scotts publishes an unclassified legacy donor surface");
  return html;
}

export function parseScottsRoot(raw: string): string {
  // Homepage testimonial/product carousels are separate from catalog paging.
  const html = inventory(raw, false);
  const text = scottsText(html);
  const declarations = [
    ...raw.matchAll(/\bvar\s+apsFrontend\s*=\s*(\{[^\n]*\});/g),
  ];
  const config: unknown = JSON.parse(declarations[0]?.[1] ?? "null");
  const directory = z
    .object({
      makesBrowseUrl: z.literal(SCOTTS_MAKES + "#aps-search-by-makes"),
    })
    .safeParse(config);
  if (
    !text.includes("full-service supplier of salvaged and used auto parts") ||
    declarations.length !== 1 ||
    !directory.success
  )
    throw new Error(
      "Scotts official physical address, on-site catalog scope or directory link changed",
    );
  // The separately held /latest-arrivals/ call is never requested. This feed
  // enumerates the independently published complete CC68 make/model graph.
  if (/aps-la-card-premium|card-price/.test(html))
    throw new Error(
      "Scotts homepage now publishes an unclassified donor or arrival surface",
    );
  return scottsHash([
    "CC68,XX00",
    "938 West Willox Lane",
    "Fort Collins",
    "CO",
    "80524",
    SCOTTS_MAKES,
  ]);
}

function oneText(html: string, tagName: string, name: string): string {
  const matches = [
    ...html.matchAll(
      new RegExp(`(<${tagName}\\b[^>]*>)([\\s\\S]*?)<\\/${tagName}\\s*>`, "gi"),
    ),
  ].filter((match) => scottsClass(match[1] ?? "", name));
  if (matches.length > 1)
    throw new Error("Repeated Scotts required field " + name);
  return scottsText(matches[0]?.[2] ?? "");
}

export function parseScottsDirectory(
  raw: string,
  kind: "makes" | "models",
  parent?: ScottsControl,
): ScottsControl[] {
  const html = inventory(raw);
  if (
    scottsDivs(html, "aps-la-card-premium").length ||
    scottsDivs(html, "aps-la-card-wrapper").length
  )
    throw new Error("Scotts directory publishes an unclassified donor surface");
  const controls: ScottsControl[] = [];
  for (const match of html.matchAll(/(<a\b[^>]*>)([\s\S]*?)<\/a>/gi)) {
    if (
      scottsClass(match[1] ?? "", "iis-center-block") &&
      !scottsClass(
        match[1] ?? "",
        kind === "makes" ? "aps-make-link" : "aps-model-link",
      )
    )
      throw new Error(
        "Scotts native directory contains an unclassified control",
      );
    if (
      !scottsClass(
        match[1] ?? "",
        kind === "makes" ? "aps-make-link" : "aps-model-link",
      )
    )
      continue;
    const body = match[2] ?? "";
    const label = oneText(body, "span", "aps-make-link__label");
    const count = oneText(body, "span", "aps-make-link__count");
    const path = scottsBrowsePath(
      attribute(match[1] ?? "", "href") ?? "",
      kind === "makes" ? 1 : 2,
    );
    if (
      !path ||
      !/^\d+$/.test(count) ||
      (parent && !path.startsWith(parent.path.replace(/\/$/, "") + "/"))
    )
      throw new Error(
        "Scotts published directory path, badge or make binding changed",
      );
    controls.push(
      ScottsControlSchema.parse({ path, label, count: Number(count) }),
    );
  }
  if (
    !controls.length ||
    controls.length > (kind === "makes" ? 64 : 128) ||
    new Set(controls.map((control) => control.path)).size !== controls.length
  )
    throw new Error(
      "Scotts published directory is empty, oversized or repeats a destination",
    );
  return controls;
}

export function parseScottsModel(
  raw: string,
  make: ScottsControl,
  model: ScottsControl,
): ScottsPage {
  const html = inventory(raw);
  if (
    !scottsText(html).includes(
      "Some vehicles may not show parts available if we haven't parted them out yet.",
    )
  )
    throw new Error("Scotts native donor inventory scope assertion changed");
  if (!model.path.startsWith(make.path.replace(/\/$/, "") + "/"))
    throw new Error("Scotts model control is outside its published make");
  const headings = [...html.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)].map(
    (match) => scottsText(match[1] ?? ""),
  );
  const normalize = (value: string) =>
    value.toLowerCase().replace(/[^a-z0-9]/g, "");
  const breadcrumb = [...html.matchAll(/(<a\b[^>]*>)([\s\S]*?)<\/a>/gi)].some(
    (match) =>
      scottsClass(match[1] ?? "", "breadcrumb-item") &&
      URL.parse(
        attribute(match[1] ?? "", "href") ?? "",
        SCOTTS_ORIGIN,
      )?.href.replace(/\/$/, "") ===
        (SCOTTS_ORIGIN + model.path).replace(/\/$/, "") &&
      normalize(scottsText(match[2] ?? "")) === normalize(model.label),
  );
  if (
    !breadcrumb &&
    !headings.some(
      (heading) =>
        normalize(heading).includes(normalize(make.label)) &&
        normalize(heading).includes(normalize(model.label)),
    )
  )
    throw new Error(
      "Scotts native model heading and literal breadcrumb do not bind the published control",
    );
  const grids = scottsDivs(html, "aps-la-grid");
  if (grids.length !== 1)
    throw new Error("Scotts expected one complete premium donor grid");
  const blocks = scottsDivs(html, "aps-la-card-premium");
  if (
    scottsDivs(grids[0]?.body ?? "", "aps-la-card-premium").length !==
    blocks.length
  )
    throw new Error("Scotts donor cards fall outside the complete native grid");
  if (
    !blocks.length ||
    blocks.length > 1000 ||
    blocks.length !== scottsDivs(html, "aps-la-card-wrapper").length
  )
    throw new Error(
      "Scotts donor wrappers and cards disagree or exceed the page bound",
    );
  const allAnchors = [...html.matchAll(/(<a\b[^>]*>)([\s\S]*?)<\/a>/gi)].filter(
    (match) => scottsClass(match[1] ?? "", "aps-la-card-link-premium"),
  );
  if (allAnchors.length !== blocks.length)
    throw new Error(
      "Scotts donor anchors fall outside the classified card universe",
    );
  const records = blocks.map(({ body, tag }): ScottsRecord => {
    const anchors = [...body.matchAll(/(<a\b[^>]*>)([\s\S]*?)<\/a>/gi)].filter(
      (match) => scottsClass(match[1] ?? "", "aps-la-card-link-premium"),
    );
    if (anchors.length !== 1)
      throw new Error("Scotts donor card lacks one literal destination");
    const anchor = anchors[0];
    const destination = attribute(anchor?.[1] ?? "", "href") ?? "";
    const url = URL.parse(destination);
    if (
      destination &&
      (!url ||
        url.origin !== SCOTTS_ORIGIN ||
        url.username ||
        url.password ||
        url.search ||
        url.hash ||
        !/^\/used-parts\/[^/]+\/[^/]+\/[^/]+\/[^/]+$/.test(url.pathname) ||
        !url.pathname.startsWith(make.path.replace(/\/$/, "") + "/"))
    )
      throw new Error(
        "Scotts donor destination is foreign or outside the published make",
      );
    const identity = anchor?.[2] ?? "";
    const vin = oneText(identity, "p", "aps-la-subtitle-premium--vin").replace(
      /^VIN:\s*/i,
      "",
    );
    const title = oneText(identity, "h3", "aps-la-title-premium");
    const years = scottsDivs(identity, "aps-la-right-val-premium");
    if (years.length > 1) throw new Error("Repeated Scotts native year region");
    const year = scottsText(
      (years[0]?.body ?? "").replace(/<span\b[^>]*>[\s\S]*?<\/span>/gi, ""),
    );
    const stocks = scottsDivs(identity, "aps-la-stat--stock").flatMap((block) =>
      scottsDivs(block.body, "aps-la-stat-value").map((value) =>
        scottsText(value.body),
      ),
    );
    const nativeStock = new Set(stocks).size === 1 ? (stocks[0] ?? "") : "";
    const stock = nativeStock.length <= 100 ? nativeStock : "";
    const images: (string | null)[] = [];
    for (const [tag] of body.matchAll(/<img\b[^>]*>/gi)) {
      try {
        if (!scottsClass(tag, "aps-la-img-premium")) continue;
        const lazy = attribute(tag, "data-src");
        const direct = attribute(tag, "src");
        images.push(lazy ?? direct);
      } catch {
        // Ambiguous optional image attributes cannot invalidate native identity.
        images.push(null);
      }
    }
    const image = new Set(images).size === 1 ? (images[0] ?? null) : null;
    const reference = image?.startsWith(SCOTTS_IMAGE_PREFIX)
      ? image.slice(SCOTTS_IMAGE_PREFIX.length)
      : null;
    return ScottsRecordSchema.parse([
      vin,
      year,
      title,
      stock,
      url?.origin === SCOTTS_ORIGIN
        ? url.href.slice(SCOTTS_ORIGIN.length)
        : destination,
      reference !== null && reference.length <= 1500 ? reference : null,
      attribute(tag, "id") ?? "",
    ]);
  });
  return { records, hash: scottsHash(records) };
}
