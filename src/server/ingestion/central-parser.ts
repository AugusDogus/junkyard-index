import { createHash } from "node:crypto";
import { z } from "zod";
import { inventoryHtmlAttribute } from "./inventory-html";
import {
  centralClass,
  centralDivs,
  centralDocument,
  centralText,
} from "./central-html";
import {
  CENTRAL_IMAGE_PREFIX,
  CENTRAL_MAKES,
  CENTRAL_ORIGIN,
  centralBrowsePath,
} from "./central-yard-metadata";

export const centralHash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
export const CentralControlSchema = z
  .object({
    path: z.string().min(1).max(300),
    label: z.string().min(1).max(100),
    count: z.number().int().min(0).max(20_000),
  })
  .strict();
export type CentralControl = z.infer<typeof CentralControlSchema>;
// Native VIN, labelled year/title/stock, literal donor href and primary image.
// Image references are compacted only against the literal DD15 prefix.
export const CentralRecordSchema = z.tuple([
  z.string().max(100),
  z.string().max(30),
  z.string().max(200),
  z.string().max(100),
  z.string().max(1000),
  z.string().max(1500).nullable(),
]);
export type CentralRecord = z.infer<typeof CentralRecordSchema>;
export const CentralPageSchema = z
  .object({
    hash: z.string().regex(/^[a-f0-9]{64}$/),
    records: z.array(CentralRecordSchema).max(1000),
  })
  .strict();
export type CentralPage = z.infer<typeof CentralPageSchema>;

const attribute = (tag: string, name: string) => {
  const value = inventoryHtmlAttribute(tag, name);
  return value === null ? null : centralText(value);
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
        "Central native pagination changed; inspect the finite published graph before resuming",
      );
    const href = attribute(tag, "href");
    if (!href) continue;
    const url = URL.parse(href, CENTRAL_ORIGIN);
    if (
      url?.origin === CENTRAL_ORIGIN &&
      (/\/page\/\d+(?:\/|$)/i.test(url.pathname) ||
        [...url.searchParams.keys()].some((key) =>
          /^(?:page|paged|offset|cursor)$/i.test(key),
        ))
    )
      throw new Error("Central native numeric continuation is not classified");
  }
  for (const match of html.matchAll(
    /(<(?:a|button)\b[^>]*>)([\s\S]*?)<\/(?:a|button)>/gi,
  )) {
    const tag = match[1] ?? "";
    if (
      centralClass(tag, "aps-gallery-carousel-control") &&
      attribute(tag, "data-bs-target") === "#apsPartsGalleryCarousel"
    )
      continue;
    const url = URL.parse(attribute(tag, "href") ?? "", CENTRAL_ORIGIN);
    if (
      /^\d+$/.test(centralText(match[2] ?? "")) &&
      url?.origin === CENTRAL_ORIGIN &&
      url.pathname.startsWith("/used-parts/") &&
      (url.search || url.hash)
    )
      throw new Error("Central numeric browse continuation is not classified");
    if (
      /^(?:next(?: page)?|previous(?: page)?|load more|show more)$/i.test(
        centralText(match[2] ?? ""),
      )
    )
      throw new Error("Central native continuation is not classified");
  }
}

function inventory(raw: string) {
  const suppliers = [...raw.matchAll(/\bvar\s+urgid\s*=\s*(['"])(.*?)\1\s*;/g)];
  if (!suppliers.length || suppliers.some((match) => match[2] !== "DD15"))
    throw new Error(
      "Central native DD15 supplier declaration is missing or changed",
    );
  const html = centralDocument(raw);
  terminal(html);
  if (centralDivs(html, "card-price").length)
    throw new Error("Central publishes an unclassified legacy donor surface");
  return html;
}

export function parseCentralRoot(raw: string): string {
  const html = inventory(raw);
  const text = centralText(html);
  const directory = [...html.matchAll(/<a\b[^>]*>/gi)].some(
    ([tag]) =>
      URL.parse(attribute(tag, "href") ?? "", CENTRAL_ORIGIN)?.href ===
      CENTRAL_MAKES,
  );
  if (
    !text.includes("245 Davis Road") ||
    !text.includes("Franklin") ||
    !text.includes("07416") ||
    !text.includes("On-Site") ||
    !directory
  )
    throw new Error(
      "Central official physical address, on-site catalog scope or directory link changed",
    );
  // A new donor/arrival surface must be classified before it can be omitted.
  if (
    /aps-la-card-premium|card-price/.test(html) ||
    /<a\b[^>]*>[\s\S]*?(?:Latest|Recent) Arrivals/i.test(html)
  )
    throw new Error(
      "Central homepage now publishes an unclassified donor or arrival surface",
    );
  return centralHash(["DD15", "245 Davis Road", "Franklin", "NJ", "07416"]);
}

function oneText(html: string, tagName: string, name: string): string {
  const matches = [
    ...html.matchAll(
      new RegExp(`(<${tagName}\\b[^>]*>)([\\s\\S]*?)<\\/${tagName}\\s*>`, "gi"),
    ),
  ].filter((match) => centralClass(match[1] ?? "", name));
  if (matches.length > 1)
    throw new Error("Repeated Central required field " + name);
  return centralText(matches[0]?.[2] ?? "");
}

export function parseCentralDirectory(
  raw: string,
  kind: "makes" | "models",
  parent?: CentralControl,
): CentralControl[] {
  const html = inventory(raw);
  if (
    centralDivs(html, "aps-la-card-premium").length ||
    centralDivs(html, "aps-la-card-wrapper").length
  )
    throw new Error(
      "Central directory publishes an unclassified donor surface",
    );
  const controls: CentralControl[] = [];
  for (const match of html.matchAll(/(<a\b[^>]*>)([\s\S]*?)<\/a>/gi)) {
    if (
      centralClass(match[1] ?? "", "iis-center-block") &&
      !centralClass(
        match[1] ?? "",
        kind === "makes" ? "aps-make-link" : "aps-model-link",
      )
    )
      throw new Error(
        "Central native directory contains an unclassified control",
      );
    if (
      !centralClass(
        match[1] ?? "",
        kind === "makes" ? "aps-make-link" : "aps-model-link",
      )
    )
      continue;
    const body = match[2] ?? "";
    const label = oneText(body, "span", "aps-make-link__label");
    const count = oneText(body, "span", "aps-make-link__count");
    const path = centralBrowsePath(
      attribute(match[1] ?? "", "href") ?? "",
      kind === "makes" ? 1 : 2,
    );
    if (
      !path ||
      !/^\d+$/.test(count) ||
      (parent && !path.startsWith(parent.path.replace(/\/$/, "") + "/"))
    )
      throw new Error(
        "Central published directory path, badge or make binding changed",
      );
    controls.push(
      CentralControlSchema.parse({ path, label, count: Number(count) }),
    );
  }
  if (
    !controls.length ||
    controls.length > (kind === "makes" ? 64 : 128) ||
    new Set(controls.map((control) => control.path)).size !== controls.length
  )
    throw new Error(
      "Central published directory is empty, oversized or repeats a destination",
    );
  return controls;
}

export function parseCentralModel(
  raw: string,
  make: CentralControl,
  model: CentralControl,
): CentralPage {
  const html = inventory(raw);
  if (!model.path.startsWith(make.path.replace(/\/$/, "") + "/"))
    throw new Error("Central model control is outside its published make");
  const headings = [...html.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)].map(
    (match) => centralText(match[1] ?? ""),
  );
  const normalize = (value: string) =>
    value.toLowerCase().replace(/[^a-z0-9]/g, "");
  const breadcrumb = [...html.matchAll(/(<a\b[^>]*>)([\s\S]*?)<\/a>/gi)].some(
    (match) =>
      centralClass(match[1] ?? "", "breadcrumb-item") &&
      URL.parse(
        attribute(match[1] ?? "", "href") ?? "",
        CENTRAL_ORIGIN,
      )?.href.replace(/\/$/, "") ===
        (CENTRAL_ORIGIN + model.path).replace(/\/$/, "") &&
      normalize(centralText(match[2] ?? "")) === normalize(model.label),
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
      "Central native model heading and literal breadcrumb do not bind the published control",
    );
  const grids = centralDivs(html, "aps-la-grid");
  if (grids.length !== 1)
    throw new Error("Central expected one complete premium donor grid");
  const blocks = centralDivs(html, "aps-la-card-premium");
  if (
    centralDivs(grids[0]?.body ?? "", "aps-la-card-premium").length !==
    blocks.length
  )
    throw new Error(
      "Central donor cards fall outside the complete native grid",
    );
  if (
    !blocks.length ||
    blocks.length > 1000 ||
    blocks.length !== centralDivs(html, "aps-la-card-wrapper").length
  )
    throw new Error(
      "Central donor wrappers and cards disagree or exceed the page bound",
    );
  const allAnchors = [...html.matchAll(/(<a\b[^>]*>)([\s\S]*?)<\/a>/gi)].filter(
    (match) => centralClass(match[1] ?? "", "aps-la-card-link-premium"),
  );
  if (allAnchors.length !== blocks.length)
    throw new Error(
      "Central donor anchors fall outside the classified card universe",
    );
  const records = blocks.map(({ body }): CentralRecord => {
    const anchors = [...body.matchAll(/(<a\b[^>]*>)([\s\S]*?)<\/a>/gi)].filter(
      (match) => centralClass(match[1] ?? "", "aps-la-card-link-premium"),
    );
    if (anchors.length !== 1)
      throw new Error("Central donor card lacks one literal destination");
    const anchor = anchors[0];
    const destination = attribute(anchor?.[1] ?? "", "href") ?? "";
    const url = URL.parse(destination);
    if (
      destination &&
      (!url ||
        url.origin !== CENTRAL_ORIGIN ||
        url.username ||
        url.password ||
        url.search ||
        url.hash ||
        !/^\/used-parts\/[^/]+\/[^/]+\/[^/]+\/[^/]+$/.test(url.pathname) ||
        !url.pathname.startsWith(make.path.replace(/\/$/, "") + "/"))
    )
      throw new Error(
        "Central donor destination is foreign or outside the published make",
      );
    const identity = anchor?.[2] ?? "";
    const vin = oneText(identity, "p", "aps-la-subtitle-premium--vin").replace(
      /^VIN:\s*/i,
      "",
    );
    const title = oneText(identity, "h3", "aps-la-title-premium");
    const years = centralDivs(identity, "aps-la-right-val-premium");
    if (years.length > 1)
      throw new Error("Repeated Central native year region");
    const year = centralText(
      (years[0]?.body ?? "").replace(/<span\b[^>]*>[\s\S]*?<\/span>/gi, ""),
    );
    const stocks = centralDivs(identity, "aps-la-stat--stock").flatMap(
      (block) =>
        centralDivs(block.body, "aps-la-stat-value").map((value) =>
          centralText(value.body),
        ),
    );
    const nativeStock = new Set(stocks).size === 1 ? (stocks[0] ?? "") : "";
    const stock = nativeStock.length <= 100 ? nativeStock : "";
    const images: (string | null)[] = [];
    for (const [tag] of body.matchAll(/<img\b[^>]*>/gi)) {
      try {
        if (!centralClass(tag, "aps-la-img-premium")) continue;
        const lazy = attribute(tag, "data-src");
        const direct = attribute(tag, "src");
        images.push(lazy ?? direct);
      } catch {
        // Ambiguous optional image attributes cannot invalidate native identity.
        images.push(null);
      }
    }
    const image = new Set(images).size === 1 ? (images[0] ?? null) : null;
    const reference = image?.startsWith(CENTRAL_IMAGE_PREFIX)
      ? image.slice(CENTRAL_IMAGE_PREFIX.length)
      : null;
    return CentralRecordSchema.parse([
      vin,
      year,
      title,
      stock,
      url?.origin === CENTRAL_ORIGIN
        ? url.href.slice(CENTRAL_ORIGIN.length)
        : destination,
      reference !== null && reference.length <= 1500 ? reference : null,
    ]);
  });
  return { records, hash: centralHash(records) };
}
