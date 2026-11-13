import { createHash } from "node:crypto";
import { z } from "zod";
import {
  inventoryHtmlAttribute,
  stripInventoryRawText,
} from "./inventory-html";
import { RohnerArticleRawSchema, type RohnerArticleRaw } from "./rohner-record";

export const ROHNER_MAX_BODY_BYTES = 2 * 1024 * 1024;
export const rohnerClass = (tag: string, name: string) =>
  (inventoryHtmlAttribute(tag, "class") ?? "").split(/\s+/).includes(name);

/** Decode one native representation, retaining the original alongside claims. */
export function rohnerDecode(raw: string): string {
  const entities: Record<string, string> = {
    amp: "&",
    nbsp: "\u00a0",
    quot: '"',
    apos: "'",
    lt: "<",
    gt: ">",
    ndash: "\u2013",
    mdash: "\u2014",
    hellip: "…",
    rarr: "→",
    larr: "←",
    rsquo: "’",
    lsquo: "‘",
    rdquo: "”",
    ldquo: "“",
    copy: "©",
  };
  return raw.replace(
    /&(#x[\da-f]+|#\d+|[a-z]+);/gi,
    (whole: string, key: string) => {
      if (!key.startsWith("#")) return entities[key.toLowerCase()] ?? whole;
      const hex = /^#x/i.test(key);
      const point = Number.parseInt(key.slice(hex ? 2 : 1), hex ? 16 : 10);
      return point > 0 &&
        point <= 0x10ffff &&
        !(point >= 0xd800 && point <= 0xdfff)
        ? String.fromCodePoint(point)
        : whole;
    },
  );
}

export const rohnerText = (raw: string) =>
  rohnerDecode(raw.replace(/<[^>]*>/g, " ")).trim();

export function rohnerDocument(raw: string): string {
  const clean = stripInventoryRawText(raw);
  if (
    Buffer.byteLength(raw) > ROHNER_MAX_BODY_BYTES ||
    !/<\/html\s*>\s*$/i.test(clean)
  )
    throw new Error(
      "Rohner native HTML exceeds 2 MiB or is incomplete; preserve the response and inspect the source",
    );
  return clean;
}

/** Balance the inspected region without repairing malformed native markup. */
export function rohnerRegions(
  html: string,
  element: string,
  matches: (tag: string) => boolean,
) {
  const regions: { tag: string; body: string; full: string }[] = [];
  let opening: { start: number; end: number; tag: string } | null = null;
  let depth = 0;
  for (const match of html.matchAll(
    new RegExp(`<\\/?${element}\\b[^>]*>`, "gi"),
  )) {
    const tag = match[0];
    if (opening === null) {
      if (!/^<\//.test(tag) && matches(tag)) {
        opening = { start: match.index, end: match.index + tag.length, tag };
        depth = 1;
      }
    } else if (/^<\//.test(tag)) {
      if (--depth === 0) {
        regions.push({
          tag: opening.tag,
          body: html.slice(opening.end, match.index),
          full: html.slice(opening.start, match.index + tag.length),
        });
        opening = null;
      }
    } else {
      if (matches(tag))
        throw new Error(
          "Rohner native region is unexpectedly nested: " + element,
        );
      depth++;
    }
  }
  if (opening !== null)
    throw new Error("Rohner native region is incomplete: " + element);
  return regions;
}

const attributes = (tag: string, keys: string[]) => {
  const values: Record<string, string> = {};
  for (const key of keys) {
    const value = inventoryHtmlAttribute(tag, key);
    if (value !== null) values[key] = rohnerDecode(value);
  }
  return values;
};

function directText(html: string): string {
  let depth = 0;
  let end = 0;
  let value = "";
  for (const match of html.matchAll(/<\/?([a-z][\w:-]*)\b[^>]*>/gi)) {
    if (depth === 0) value += html.slice(end, match.index);
    const closing = /^<\//.test(match[0]);
    if (closing) depth--;
    else if (
      !/^(?:area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)$/i.test(
        match[1] ?? "",
      ) &&
      !/\/\s*>$/.test(match[0])
    )
      depth++;
    if (depth < 0) throw new Error("Rohner breadcrumb child is malformed");
    end = match.index + match[0].length;
  }
  if (depth !== 0) throw new Error("Rohner breadcrumb child is incomplete");
  return rohnerDecode(value + html.slice(end));
}

export function extractRohnerArticle(
  raw: string,
  requestUrl: string,
): RohnerArticleRaw {
  const html = rohnerDocument(raw);
  const result: RohnerArticleRaw = {
    requestUrl,
    body: {
      bytes: Buffer.byteLength(raw),
      sha256: createHash("sha256").update(raw).digest("hex"),
    },
    summaries: [],
    namedClaims: [],
    destinationClaims: [],
    galleryImages: [],
    structuredDocuments: [],
    structuredParseErrors: [],
  };
  for (const title of rohnerRegions(html, "title", () => true))
    result.namedClaims.push({
      boundary: "document-title",
      value: rohnerText(title.body),
    });
  for (const [tag] of html.matchAll(/<meta\b[^>]*>/gi)) {
    const property =
      inventoryHtmlAttribute(tag, "property") ??
      inventoryHtmlAttribute(tag, "name");
    if (property === "og:title" || property === "twitter:title")
      result.namedClaims.push({
        boundary: property,
        value: rohnerDecode(inventoryHtmlAttribute(tag, "content") ?? ""),
      });
  }
  for (const [tag] of html.matchAll(/<link\b[^>]*>/gi)) {
    if (
      (inventoryHtmlAttribute(tag, "rel") ?? "")
        .split(/\s+/)
        .includes("canonical")
    )
      result.destinationClaims.push({
        boundary: "canonical",
        value: rohnerDecode(inventoryHtmlAttribute(tag, "href") ?? ""),
      });
  }
  for (const [tag] of html.matchAll(/<meta\b[^>]*>/gi))
    if (inventoryHtmlAttribute(tag, "property") === "og:url")
      result.destinationClaims.push({
        boundary: "og:url",
        value: rohnerDecode(inventoryHtmlAttribute(tag, "content") ?? ""),
      });
  for (const [index, summary] of rohnerRegions(
    html,
    "div",
    (tag) => rohnerClass(tag, "summary") && rohnerClass(tag, "entry-summary"),
  ).entries()) {
    const fields: RohnerArticleRaw["summaries"][number]["fields"] = [];
    const unlabelledLines: string[] = [];
    for (const description of rohnerRegions(summary.body, "div", (tag) =>
      rohnerClass(tag, "woocommerce-product-details__short-description"),
    )) {
      const lines = rohnerDecode(
        description.body.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]*>/g, ""),
      ).split(/\r?\n/);
      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line) continue;
        const colon = line.indexOf(":");
        if (colon < 0) unlabelledLines.push(line);
        else
          fields.push({
            boundary: `summary-${index}-short-description`,
            label: line.slice(0, colon).trim(),
            value: line.slice(colon + 1).trim(),
            raw: line,
          });
      }
    }
    const titles = rohnerRegions(summary.body, "h1", (tag) =>
      rohnerClass(tag, "product_title"),
    ).map((node) => rohnerText(node.body));
    result.namedClaims.push(
      ...titles.map((value) => ({ boundary: `summary-${index}-h1`, value })),
    );
    for (const node of rohnerRegions(summary.body, "nav", (tag) =>
      rohnerClass(tag, "woocommerce-breadcrumb"),
    )) {
      const value = directText(node.body)
        .replace(/^[\s/]+/, "")
        .trim();
      if (value)
        result.namedClaims.push({
          boundary: `summary-${index}-breadcrumb-leaf`,
          value,
        });
    }
    const categories = rohnerRegions(
      summary.body,
      "span",
      (tag) =>
        rohnerClass(tag, "single-product-category") ||
        rohnerClass(tag, "posted_in"),
    ).flatMap((node) =>
      rohnerRegions(node.body, "a", () => true).map((anchor) => ({
        text: rohnerText(anchor.body),
        href: rohnerDecode(inventoryHtmlAttribute(anchor.tag, "href") ?? ""),
      })),
    );
    result.summaries.push({
      titles,
      fields,
      unlabelledLines,
      skuValues: rohnerRegions(summary.body, "span", (tag) =>
        rohnerClass(tag, "sku"),
      ).map((node) => rohnerText(node.body)),
      categories,
      fullText: rohnerText(summary.body),
    });
  }
  for (const gallery of rohnerRegions(html, "div", (tag) =>
    rohnerClass(tag, "woocommerce-product-gallery"),
  )) {
    for (const [tag] of gallery.body.matchAll(/<img\b[^>]*>/gi))
      result.galleryImages.push(
        attributes(tag, [
          "alt",
          "title",
          "src",
          "srcset",
          "data-src",
          "data-large_image",
          "data-caption",
        ]),
      );
    for (const [tag] of (gallery.tag + gallery.body).matchAll(
      /<[a-z][\w:-]*\b[^>]*>/gi,
    ))
      for (const [key, value] of Object.entries(
        attributes(tag, [
          "alt",
          "title",
          "data-thumb-alt",
          "data-caption",
          "aria-label",
        ]),
      ))
        if (value)
          result.namedClaims.push({ boundary: "gallery-image-" + key, value });
  }
  function requiredClaim(label: string, value: unknown, boundary: string) {
    if (typeof value === "string" || typeof value === "number")
      for (const summary of result.summaries)
        summary.fields.push({
          boundary,
          label,
          value: rohnerDecode(String(value)),
          raw: String(value),
        });
  }
  function structured(value: unknown, donorContext = false): void {
    const array = z.array(z.unknown()).safeParse(value);
    if (array.success) {
      for (const item of array.data) structured(item, donorContext);
      return;
    }
    const object = z.record(z.unknown()).safeParse(value);
    if (!object.success) return;
    const node = object.data;
    const types =
      typeof node["@type"] === "string"
        ? [node["@type"]]
        : z.array(z.string()).parse(node["@type"] ?? []);
    donorContext ||= types.some((type) =>
      ["WebPage", "Product", "ProductGroup", "Vehicle", "Car"].includes(type),
    );
    for (const key of ["name", "caption"]) {
      const text = node[key];
      if (typeof text === "string")
        result.namedClaims.push({
          boundary: "structured-" + types.join("/") + "." + key,
          value: rohnerDecode(text),
          rawValue: text,
        });
    }
    if (types.includes("WebPage"))
      for (const key of ["@id", "url"]) {
        const text = node[key];
        if (typeof text === "string")
          result.destinationClaims.push({
            boundary: "WebPage." + key,
            value: text,
          });
      }
    if (
      types.some((type) =>
        ["Product", "ProductGroup", "Vehicle", "Car"].includes(type),
      )
    ) {
      for (const key of ["url", "@id"]) {
        const text = node[key];
        if (typeof text === "string")
          result.destinationClaims.push({
            boundary: "Product." + key,
            value: text,
          });
      }
      for (const key of ["vehicleIdentificationNumber", "vin"])
        requiredClaim("VIN", node[key], "structured-" + key);
    }
    if (
      donorContext &&
      types.includes("PropertyValue") &&
      typeof node.name === "string" &&
      /^(?:year|make|model|vin)$/i.test(node.name)
    )
      requiredClaim(node.name, node.value, "structured-PropertyValue");
    if (
      donorContext &&
      types.some((type) => ["ReadAction", "BuyAction"].includes(type))
    ) {
      const targets = z.array(z.unknown()).safeParse(node.target);
      for (const target of targets.success ? targets.data : [node.target]) {
        const object = z.object({ urlTemplate: z.string() }).safeParse(target);
        const text =
          typeof target === "string"
            ? target
            : object.success
              ? object.data.urlTemplate
              : null;
        if (text !== null)
          result.destinationClaims.push({
            boundary: "potentialAction.target",
            value: text,
          });
      }
    }
    if (types.some((type) => ["Vehicle", "Car"].includes(type))) {
      for (const [key, label] of [
        ["modelDate", "Year"],
        ["vehicleModelDate", "Year"],
        ["model", "Model"],
      ])
        if (key && label)
          requiredClaim(label, node[key], "structured-Vehicle." + key);
      for (const key of ["brand", "manufacturer"]) {
        const object = z.object({ name: z.unknown() }).safeParse(node[key]);
        requiredClaim(
          "Make",
          object.success ? object.data.name : node[key],
          "structured-Vehicle." + key,
        );
      }
    }
    for (const child of Object.values(node)) structured(child, donorContext);
  }
  for (const match of raw.matchAll(
    /(<script\b[^>]*>)([\s\S]*?)<\/script\s*>/gi,
  )) {
    if (
      inventoryHtmlAttribute(match[1] ?? "", "type") !== "application/ld+json"
    )
      continue;
    const text = match[2] ?? "";
    try {
      const value: unknown = JSON.parse(text);
      result.structuredDocuments.push(value);
      structured(value);
    } catch (error) {
      result.structuredParseErrors.push({
        error: error instanceof Error ? error.message : String(error),
        raw: text,
      });
    }
  }
  return RohnerArticleRawSchema.parse(result);
}
