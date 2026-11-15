import { Effect } from "effect";
import {
  inventoryHtmlAttribute,
  stripInventoryRawText,
} from "./inventory-html";
import { inventoryVin } from "./inventory-vin";
import {
  normalizeCanonicalColor,
  normalizeCanonicalMake,
} from "./normalization";
import {
  PickNSaveProviderError,
  type PickNSaveProduct,
} from "./picknsave-client";
import type { z } from "zod";
import type { PickNSaveYardCodeSchema } from "./picknsave-cursor";

export interface PickNSaveRecord {
  vin: string;
  year: number;
  make: string;
  model: string;
  color: string | null;
  stockNumber: string | null;
  row: string | null;
  yardCode: z.infer<typeof PickNSaveYardCodeSchema>;
  availableDate: string | null;
  imageUrl: string | null;
  detailsUrl: string;
}
export type PickNSaveDetail =
  | { status: "available"; record: PickNSaveRecord }
  | { status: "unavailable" }
  | { status: "incomplete"; vin: string | null; reason: string };

function text(raw: string): string {
  const entities: Record<string, string> = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    nbsp: " ",
  };
  return raw
    .replace(/<[^>]*>/g, " ")
    .replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (_entity, key: string) => {
      if (!key.startsWith("#")) {
        const value = entities[key.toLowerCase()];
        if (value === undefined)
          throw new Error(`Unsupported inventory HTML entity &${key};`);
        return value;
      }
      const hex = key.slice(0, 2).toLowerCase() === "#x";
      const value = Number.parseInt(key.slice(hex ? 2 : 1), hex ? 16 : 10);
      if (
        value <= 0 ||
        value > 0x10ffff ||
        (value >= 0xd800 && value <= 0xdfff)
      )
        throw new Error("Invalid inventory HTML character reference");
      return String.fromCodePoint(value);
    })
    .replace(/\s+/g, " ")
    .trim();
}

function parse(html: string, product: PickNSaveProduct): PickNSaveDetail {
  if (html.length > 2_000_000 || !/<\/html\s*>\s*$/i.test(html))
    throw new Error(
      "Vehicle HTML is truncated or exceeds the 2 MB character bound",
    );
  const clean = stripInventoryRawText(html);
  const wrappers = [...clean.matchAll(/<div\b[^>]*>/gi)].filter(([tag]) => {
    const classes = (inventoryHtmlAttribute(tag, "class") ?? "").split(/\s+/);
    return (
      classes.includes("product") &&
      classes.includes("type-product") &&
      classes.includes(`post-${product.id}`)
    );
  });
  const wrapper = wrappers[0]?.[0];
  if (wrappers.length !== 1 || !wrapper)
    throw new Error(
      `Expected the product wrapper for ${product.id}; wrong or incomplete vehicle page`,
    );
  const classes = (inventoryHtmlAttribute(wrapper, "class") ?? "").split(/\s+/);
  if (classes.includes("outofstock") && !classes.includes("instock"))
    return { status: "unavailable" };
  if (!classes.includes("instock") || classes.includes("outofstock"))
    throw new Error("Vehicle availability is missing or contradictory");
  const headings = [
    ...clean.matchAll(
      /<(div|h1)\b[^>]*\bclass=(?:"[^"]*\belementor-heading-title\b[^"]*"|'[^']*\belementor-heading-title\b[^']*')[^>]*>([\s\S]*?)<\/\1\s*>/gi,
    ),
  ];
  const fields = new Map<string, string>();
  const yards: PickNSaveRecord["yardCode"][] = [];
  for (const heading of headings) {
    const contents = heading[2] ?? "";
    const label = /^\s*<b>\s*([^<]+):\s*<\/b>([\s\S]*)$/i.exec(contents);
    if (label) {
      const key = text(label[1] ?? "");
      if (fields.has(key)) throw new Error(`Duplicate vehicle field ${key}`);
      fields.set(key, text(label[2] ?? ""));
    } else if (heading[1]?.toLowerCase() === "div") {
      const yard = text(contents);
      if (yard === "Lynchburg") yards.push("PNS-VA-LYNCHBURG");
      if (yard === "Roanoke") yards.push("PNS-VA-ROANOKE");
    }
  }
  // A missing value can remove the entire optional heading in Elementor. The
  // identity anchors still have to exist so a changed template fails closed.
  for (const key of ["Year", "VIN"])
    if (!fields.has(key))
      throw new Error(
        `Vehicle field ${key} disappeared; inspect the detail template before accepting a checkpoint`,
      );
  const yardCode = yards[0];
  if (yards.length !== 1 || !yardCode)
    throw new Error("Vehicle page does not identify exactly one verified yard");
  const year = fields.get("Year") ?? "";
  const vin = inventoryVin(fields.get("VIN") ?? "", year);
  const color = normalizeCanonicalColor(fields.get("Color") ?? null);
  const make = normalizeCanonicalMake(fields.get("Make") ?? "");
  const model = fields.get("Model") ?? "";
  const rawStock = fields.get("Stock") ?? "";
  const stockNumber = /^[A-Z0-9]+$/i.test(rawStock) ? rawStock : null;
  const rawRow = fields.get("Location") ?? "";
  const row =
    rawRow && !/^(?:unknown|n\/a|null)$/i.test(rawRow) ? rawRow : null;
  const rawDate = product.date ?? "";
  const date = /^\d{4}-\d{2}-\d{2}T00:00:00$/.test(rawDate)
    ? new Date(`${rawDate}Z`)
    : new Date(NaN);
  const availableDate =
    Number.isFinite(date.getTime()) &&
    date.toISOString().slice(0, 10) === rawDate.slice(0, 10)
      ? date.toISOString()
      : null;
  // The site's Open Graph image is its logo. Only a stock-matched donor photo qualifies.
  const photos = [...clean.matchAll(/<img\b[^>]*>/gi)].flatMap(([tag]) => {
    if (inventoryHtmlAttribute(tag, "product-id") !== String(product.id))
      return [];
    const raw =
      inventoryHtmlAttribute(tag, "data-large_image") ??
      inventoryHtmlAttribute(tag, "src");
    const url = raw ? URL.parse(raw) : null;
    return stockNumber &&
      url &&
      url.origin === "https://cunninghambros.s3.us-east-1.amazonaws.com" &&
      !url.search &&
      !url.hash &&
      !url.username &&
      !url.password &&
      url.pathname.startsWith(`/images/${stockNumber}/`) &&
      /\.(?:jpe?g|png)$/i.test(url.pathname)
      ? [url.href]
      : [];
  });
  const imageUrl = photos[0] ?? null;
  if (
    !vin ||
    !/^\d{4}$/.test(year) ||
    Number(year) < 1886 ||
    Number(year) > 2100 ||
    !make ||
    /^(?:other|unknown)$/i.test(make) ||
    !model ||
    /^unknown$/i.test(model)
  )
    return {
      status: "incomplete",
      vin,
      reason: "Required VIN, year, make or model is missing or invalid",
    };
  return {
    status: "available",
    record: {
      vin,
      year: Number(year),
      make,
      model,
      color,
      stockNumber,
      row,
      yardCode,
      availableDate,
      imageUrl,
      detailsUrl: product.link,
    },
  };
}

export function parsePickNSaveDetail(html: string, product: PickNSaveProduct) {
  return Effect.try({
    try: () => parse(html, product),
    catch: (cause) =>
      new PickNSaveProviderError({
        operation: `parse vehicle ${product.id}`,
        cause,
      }),
  });
}
