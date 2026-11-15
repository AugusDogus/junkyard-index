import { createHash } from "node:crypto";
import { z } from "zod";
import { stripInventoryRawText } from "./inventory-html";
import {
  prattAttribute as attribute,
  prattClass as hasClass,
  prattElements as elements,
  prattRegion as region,
  prattText as text,
  prattContinuation as continuation,
} from "./pratt-html";
import {
  JIMSIMPORT_MAX_BYTES,
  JIMSIMPORT_ORIGIN,
  JIMSIMPORT_YARD,
} from "./jimsimport-yard-metadata";

export const jimsimportHash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
export function jimsimportOwnedUrl(raw: string): URL | null {
  const url = URL.parse(raw, JIMSIMPORT_ORIGIN);
  return url &&
    url.origin === JIMSIMPORT_ORIGIN &&
    !url.username &&
    !url.password &&
    !url.search &&
    !url.hash
    ? url
    : null;
}
export const JimsimportControlSchema = z
  .object({
    path: z.string().max(500),
    label: z.string().min(1).max(200),
    count: z.number().int().nonnegative(),
  })
  .strict();
export type JimsimportControl = z.infer<typeof JimsimportControlSchema>;
export const JimsimportMenuSchema = z
  .object({
    make: JimsimportControlSchema,
    models: z.array(JimsimportControlSchema).min(1).max(1024),
  })
  .strict();
export type JimsimportMenu = z.infer<typeof JimsimportMenuSchema>;
export const JimsimportRecordSchema = z
  .object({
    id: z.string().nullable(),
    title: z.string(),
    vin: z.string().nullable(),
    year: z.string(),
    stock: z.string(),
    destinations: z.array(z.string()).max(8),
    image: z.string().nullable(),
  })
  .strict();
export type JimsimportRecord = z.infer<typeof JimsimportRecordSchema>;
export const JimsimportPageSchema = z
  .object({
    makePath: z.string(),
    modelPath: z.string(),
    records: z.array(JimsimportRecordSchema).max(499),
    nativeEmpty: z.boolean(),
  })
  .strict();
export type JimsimportPage = z.infer<typeof JimsimportPageSchema>;

function document(raw: string) {
  const html = stripInventoryRawText(raw);
  if (
    Buffer.byteLength(raw) > JIMSIMPORT_MAX_BYTES ||
    [/<html\b/gi, /<body\b/gi, /<\/body\s*>/gi, /<\/html\s*>/gi].some(
      (pattern) => [...html.matchAll(pattern)].length !== 1,
    ) ||
    !/<\/body\s*>\s*<\/html\s*>\s*$/i.test(html)
  )
    throw new Error("Jim's Import native document is oversized or incomplete");
  const suppliers = [...raw.matchAll(/\bvar\s+urgid\s*=\s*(['"])(.*?)\1\s*;/g)];
  if (!suppliers.length || suppliers.some((match) => match[2] !== "NN38"))
    throw new Error("Jim's Import NN38 supplier is missing or conflicting");
  return html;
}
function main(raw: string, kind: "makes" | "models" | "vehicles") {
  const html = region(
    document(raw),
    (tag) => attribute(tag, "id") === "iiscont",
  );
  const blocks = elements(html, "div", (tag) =>
    hasClass(tag, "aps-parts-main"),
  );
  const block = blocks[0];
  if (
    !block ||
    blocks.length !== 1 ||
    attribute(block.tag, "data-type") !== kind
  )
    throw new Error("Jim's Import native inventory type or boundary changed");
  // The image-gallery arrows are published outside aps-parts-main. Exempt
  // only those exact carousel controls, so new inventory paging anywhere in
  // iiscont cannot silently escape complete enumeration.
  const unread = continuation(html).filter((control) => {
    const tag = /^<[^>]*>/.exec(control)?.[0] ?? "";
    const direction = attribute(tag, "data-bs-slide");
    return !(
      attribute(tag, "data-bs-target") === "#apsPartsGalleryCarousel" &&
      ((direction === "next" && hasClass(tag, "carousel-control-next")) ||
        (direction === "prev" && hasClass(tag, "carousel-control-prev")))
    );
  });
  if (unread.length)
    throw new Error("Jim's Import has unread native continuation controls");
  return block.body;
}
export function jimsimportControlPath(raw: string, depth: 1 | 2) {
  const url = jimsimportOwnedUrl(raw);
  return url &&
    /^\/used-parts\/[^/]+(?:\/[^/]+)?\/?$/.test(url.pathname) &&
    url.pathname.split("/").filter(Boolean).length === depth + 1 &&
    url.pathname.replace(/\/$/, "") !== "/used-parts/makes"
    ? url.pathname
    : null;
}
export function parseJimsimportDirectory(
  raw: string,
  make?: JimsimportControl,
) {
  const html = main(raw, make ? "models" : "makes");
  const menu = region(html, (tag) =>
    make
      ? attribute(tag, "id") === "menumodellist"
      : hasClass(tag, "iisMakesMenu"),
  );
  const links = elements(menu, "a"),
    rows = elements(menu, "li");
  if (!rows.length || rows.length !== links.length || rows.length > 1024)
    throw new Error(
      "Jim's Import complete directory controls are missing or ambiguous",
    );
  const controls = rows.map((row) => {
    const anchors = elements(row.body, "a"),
      link = anchors[0];
    const labels = elements(row.body, "span", (tag) =>
      hasClass(tag, "aps-make-link__label"),
    );
    const badges = elements(row.body, "span", (tag) => hasClass(tag, "badge"));
    const label = attribute(row.tag, "id"),
      count = text(badges[0]?.body ?? "");
    const path = jimsimportControlPath(
      attribute(link?.tag ?? "", "href") ?? "",
      make ? 2 : 1,
    );
    if (
      !path ||
      !label ||
      anchors.length !== 1 ||
      labels.length !== 1 ||
      badges.length !== 1 ||
      !/^\d+$/.test(count) ||
      text(labels[0]?.body ?? "") !== label.replaceAll("_", " ") ||
      (make && !path.startsWith(make.path.replace(/\/$/, "") + "/"))
    )
      throw new Error(
        "Jim's Import native control path, parent, label or badge changed",
      );
    return JimsimportControlSchema.parse({ path, label, count: Number(count) });
  });
  if (new Set(controls.map((c) => c.path)).size !== controls.length)
    throw new Error("Jim's Import directory repeats a native destination");
  return controls;
}
const single = (html: string, name: string, css: string) => {
  const values = elements(html, name, (tag) => hasClass(tag, css));
  if (values.length > 1) throw new Error("Jim's Import repeated native " + css);
  return values[0];
};
export function parseJimsimportModel(
  raw: string,
  make: JimsimportControl,
  model: JimsimportControl,
): JimsimportPage {
  const html = main(raw, "vehicles");
  const cards = elements(html, "div", (tag) =>
    hasClass(tag, "aps-la-card-premium"),
  );
  const empty = text(html).includes(
    "Sorry Not Found On The Website, But We Can Get It!",
  );
  if (
    (!cards.length && !empty) ||
    (cards.length && empty) ||
    cards.length >= 500 ||
    elements(html, "div", (tag) => hasClass(tag, "aps-la-car-details"))
      .length !== cards.length
  )
    throw new Error(
      "Jim's Import native donor census is missing, contradictory or at the 500-card boundary",
    );
  if (cards.length) {
    const grid = region(html, (tag) => hasClass(tag, "aps-la-grid"));
    if (
      elements(grid, "div", (tag) => hasClass(tag, "aps-la-card-premium"))
        .length !== cards.length
    )
      throw new Error(
        "Jim's Import donor cards exist outside the complete grid",
      );
  }
  const records = cards.map((card) => {
    const title = single(card.body, "h3", "aps-la-title-premium");
    const vin = single(card.body, "p", "aps-la-subtitle-premium--vin");
    const year = single(card.body, "div", "aps-la-right-val-premium");
    const stockRegion = single(card.body, "div", "aps-la-stat--stock");
    const stock = single(stockRegion?.body ?? "", "div", "aps-la-stat-value");
    const destinations = elements(
      card.body,
      "a",
      (tag) =>
        hasClass(tag, "aps-la-card-link-premium") ||
        hasClass(tag, "aps-la-parts-btn"),
    ).map((link) => attribute(link.tag, "href") ?? "");
    if (!title || !year || !stock || !destinations.length)
      throw new Error("Jim's Import native donor field boundary changed");
    let image: string | null = null;
    // Malformed optional metadata cannot erase an otherwise supplied identity.
    try {
      const picture = single(card.body, "div", "aps-la-img-wrap-premium");
      const imgs = [...(picture?.body ?? "").matchAll(/<img\b[^>]*>/gi)];
      if (imgs.length === 1) image = attribute(imgs[0]?.[0] ?? "", "src");
    } catch {
      image = null;
    }
    return {
      id: attribute(card.tag, "id"),
      title: text(title.body),
      vin: vin ? text(vin.body).replace(/^VIN:\s*/, "") : null,
      year: text(year.body).replace(/^Year\s*/, ""),
      stock: text(stock.body),
      destinations,
      image,
    };
  });
  return {
    makePath: make.path,
    modelPath: model.path,
    records,
    nativeEmpty: empty,
  };
}
export function parseJimsimportOwner(raw: string) {
  const value = text(document(raw)).replaceAll("’", "'");
  if (
    ![
      "Jims Import Auto Salvage",
      "3636 DeSoto Rd",
      "Sebring",
      "33870",
      "863-471-1177",
    ].every((claim) => value.includes(claim))
  )
    throw new Error("Jim's Import physical owner or Sebring address changed");
  return jimsimportHash(JIMSIMPORT_YARD);
}
export const jimsimportRequiredPage = (page: JimsimportPage) => ({
  ...page,
  records: page.records.map(({ image, ...required }) => {
    void image;
    return required;
  }),
});
export const jimsimportDirectoryMembership = (
  controls: readonly JimsimportControl[],
) => controls.map(({ path, label }) => ({ path, label }));
