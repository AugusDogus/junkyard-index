import { createHash } from "node:crypto";
import { z } from "zod";
import { inventoryHtmlAttribute } from "./inventory-html";
import {
  aviationClass,
  aviationDivs,
  aviationDocument,
  aviationText,
} from "./aviation-html";
import {
  AVIATION_IMAGE_PREFIX,
  AVIATION_ORIGIN,
  AVIATION_MAKES,
  aviationBrowsePath,
} from "./aviation-yard-metadata";

export const aviationHash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
export const AviationControlSchema = z
  .object({
    path: z.string().min(1).max(300),
    label: z.string().min(1).max(100),
    count: z.number().int().min(0).max(10_000),
  })
  .strict();
export type AviationControl = z.infer<typeof AviationControlSchema>;

// Raw native values, losslessly compacted for the durable checkpoint. No HTML,
// inferred VIN data or materialized canonical arrays cross the workflow boundary.
export const AviationRecordSchema = z.tuple([
  z.string().max(100), // VIN or legacy serial
  z.string().max(30), // year
  z.string().max(200), // combined native make/model title
  z.string().max(100), // native traversal stock
  z.string().max(1000), // literal native donor destination
  z.string().max(1500).nullable(), // native image reference
  z.string().max(100).nullable(), // labelled Enter Date
]);
export type AviationRecord = z.infer<typeof AviationRecordSchema>;
export const AviationPageSchema = z
  .object({
    hash: z.string().regex(/^[a-f0-9]{64}$/),
    records: z.array(AviationRecordSchema).max(1000),
  })
  .strict();
export type AviationPage = z.infer<typeof AviationPageSchema>;

function terminal(html: string) {
  for (const match of html.matchAll(
    /(<(?:a|button)\b[^>]*>)([\s\S]*?)<\/(?:a|button)>/gi,
  )) {
    const tag = match[1] ?? "";
    const body = match[2] ?? "";
    const classes = inventoryHtmlAttribute(tag, "class") ?? "";
    if (
      /paginat|page-link|load.?more/i.test(classes) ||
      inventoryHtmlAttribute(tag, "data-aps-page") !== null ||
      /^(?:next|prev)$/i.test(inventoryHtmlAttribute(tag, "rel") ?? "")
    )
      throw new Error(
        "Aviation native donor continuation changed: " + aviationText(body),
      );
  }
}

function region(raw: string, type: "makes" | "models" | "vehicles") {
  const html = aviationDocument(raw);
  const regions = aviationDivs(html, "aps-parts-main");
  const main = regions[0];
  if (
    regions.length !== 1 ||
    !main ||
    inventoryHtmlAttribute(main.tag, "data-type") !== type
  )
    throw new Error(
      "Aviation expected one complete native " + type + " region",
    );
  terminal(main.body);
  return main.body;
}

export function parseAviationDirectory(
  raw: string,
  kind: "makes" | "models",
  parent?: AviationControl,
): AviationControl[] {
  const html = region(raw, kind);
  const className = kind === "makes" ? "aps-make-link" : "aps-model-link";
  const controls: AviationControl[] = [];
  for (const match of html.matchAll(/(<a\b[^>]*>)([\s\S]*?)<\/a>/gi)) {
    if (!aviationClass(match[1] ?? "", className)) continue;
    const url = aviationText(
      inventoryHtmlAttribute(match[1] ?? "", "href") ?? "",
    );
    const path = aviationBrowsePath(url, kind === "makes" ? 1 : 2);
    const spans = [
      ...(match[2] ?? "").matchAll(/(<span\b[^>]*>)([\s\S]*?)<\/span>/gi),
    ];
    const label = aviationText(
      spans.find((m) =>
        aviationClass(m[1] ?? "", "aps-make-link__label"),
      )?.[2] ?? "",
    );
    const count = aviationText(
      spans.find((m) =>
        aviationClass(m[1] ?? "", "aps-make-link__count"),
      )?.[2] ?? "",
    );
    if (
      !path ||
      !/^\d+$/.test(count) ||
      (parent && !path.startsWith(parent.path + "/"))
    )
      throw new Error(
        "Aviation published directory path/count or parent binding changed",
      );
    controls.push(
      AviationControlSchema.parse({ path, label, count: Number(count) }),
    );
  }
  if (
    controls.length === 0 ||
    controls.length > (kind === "makes" ? 64 : 128) ||
    new Set(controls.map((c) => c.path)).size !== controls.length
  )
    throw new Error(
      "Aviation directory is empty, oversized or repeats a native destination",
    );
  return controls;
}

function field(card: string, className: string) {
  const divs = aviationDivs(card, className);
  if (divs.length > 1)
    throw new Error("Repeated Aviation card field " + className);
  return aviationText(divs[0]?.body ?? "");
}

function cards(html: string): AviationPage {
  const records: AviationRecord[] = aviationDivs(
    html,
    "aps-la-card-premium",
  ).map(({ body }) => {
    const titles = [...body.matchAll(/(<h3\b[^>]*>)([\s\S]*?)<\/h3>/gi)].filter(
      (m) => aviationClass(m[1] ?? "", "aps-la-title-premium"),
    );
    const vins = [...body.matchAll(/(<p\b[^>]*>)([\s\S]*?)<\/p>/gi)].filter(
      (m) => aviationClass(m[1] ?? "", "aps-la-subtitle-premium--vin"),
    );
    const anchors = [...body.matchAll(/(<a\b[^>]*>)([\s\S]*?)<\/a>/gi)].filter(
      (m) => aviationClass(m[1] ?? "", "aps-la-card-link-premium"),
    );
    if (titles.length > 1 || vins.length > 1 || anchors.length !== 1)
      throw new Error(
        "Aviation donor card repeats identity fields or lacks its native destination",
      );
    const stock = field(
      aviationDivs(body, "aps-la-stat--stock")[0]?.body ?? "",
      "aps-la-stat-value",
    );
    const date = field(
      aviationDivs(body, "aps-la-stat--arrive")[0]?.body ?? "",
      "aps-la-stat-value",
    );
    const images = [...body.matchAll(/<img\b[^>]*>/gi)].filter(([tag]) =>
      aviationClass(tag, "aps-la-img-premium"),
    );
    const destination = aviationText(
      inventoryHtmlAttribute(anchors[0]?.[1] ?? "", "href") ?? "",
    );
    const imageValue = images[0]
      ? inventoryHtmlAttribute(images[0][0], "src")
      : null;
    const image = imageValue === null ? null : aviationText(imageValue);
    return AviationRecordSchema.parse([
      aviationText(vins[0]?.[2] ?? "").replace(/^VIN:\s*/, ""),
      field(body, "aps-la-right-val-premium").replace(/^Year\s*/, ""),
      aviationText(titles[0]?.[2] ?? ""),
      stock,
      destination.startsWith(AVIATION_ORIGIN + "/")
        ? destination.slice(AVIATION_ORIGIN.length)
        : destination,
      image?.startsWith(AVIATION_IMAGE_PREFIX)
        ? image.slice(AVIATION_IMAGE_PREFIX.length)
        : image,
      date || null,
    ]);
  });
  if (records.length === 0 || records.length > 1000)
    throw new Error(
      "Aviation native donor list is empty or exceeds the inspected page capacity",
    );
  return { records, hash: aviationHash(records) };
}

export function parseAviationModel(
  raw: string,
  make: AviationControl,
  model: AviationControl,
): AviationPage {
  const html = region(raw, "vehicles");
  if (
    !aviationText(html).includes(
      "Some vehicles may not show parts available if we haven't parted them out yet.",
    )
  )
    throw new Error("Aviation donor/awaiting-partout scope changed");
  const all = aviationDocument(raw);
  const breadcrumb = [...all.matchAll(/(<a\b[^>]*>)([\s\S]*?)<\/a>/gi)].some(
    (m) => {
      const url = URL.parse(
        inventoryHtmlAttribute(m[1] ?? "", "href") ?? "",
        AVIATION_ORIGIN,
      );
      return (
        url?.origin === AVIATION_ORIGIN &&
        url.pathname === model.path + "/" &&
        aviationText(m[2] ?? "") === model.label
      );
    },
  );
  if (!model.path.startsWith(make.path + "/") || !breadcrumb)
    throw new Error(
      "Aviation native model breadcrumb no longer binds the published directory",
    );
  return cards(html);
}

export function parseAviationRoot(raw: string): AviationPage {
  const html = aviationDocument(raw);
  if (
    !raw.includes(
      '"makesBrowseUrl":"' + AVIATION_MAKES + '#aps-search-by-makes"',
    )
  )
    throw new Error("Aviation configured native browse destination changed");
  const regions = aviationDivs(html, "aps-latest-arrivals");
  if (regions.length !== 1 || !/Latest Arrivals/.test(aviationText(html)))
    throw new Error(
      "Aviation native recent-arrival surface is missing or ambiguous",
    );
  terminal(regions[0]?.body ?? "");
  return cards(regions[0]?.body ?? "");
}

export function parseAviationContact(raw: string): string {
  const html = aviationDocument(raw);
  const text = aviationText(html);
  const map = [...html.matchAll(/<iframe\b[^>]*>/gi)].some(([tag]) => {
    const url = URL.parse(
      aviationText(inventoryHtmlAttribute(tag, "src") ?? ""),
    );
    return (
      url?.origin === "https://maps.google.com" &&
      url.searchParams.get("q") ===
        "Aviation Auto Salvage Recycle 5231 E Drexel Rd, Tucson, AZ 85706"
    );
  });
  if (!text.includes("5231 East Drexel Tucson, AZ 85706") || !map)
    throw new Error(
      "Aviation official physical address or address-bound map changed",
    );
  return aviationHash([
    "5231 East Drexel",
    "Tucson",
    "AZ",
    "85706",
    "520-574-1700",
  ]);
}
