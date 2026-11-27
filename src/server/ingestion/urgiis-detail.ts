import { iisAttribute, iisClass, iisElements, iisText } from "./iis-html";
import { iisDocument } from "./urgiis-catalog";
import type { UrgiisTenant } from "./urgiis-tenant";

const values = (html: string, name: string) =>
  [...html.matchAll(/<input\b[^>]*>/gi)].flatMap(([tag]) =>
    iisAttribute(tag, "name") === name
      ? [iisAttribute(tag, "value") ?? ""]
      : [],
  );
const pageVins = (html: string) =>
  iisElements(html, "li", (tag) => iisClass(tag, "iispartpagevin"))
    .map(({ body }) =>
      iisText(body)
        .replace(/^VIN\s*:\s*/i, "")
        .trim()
        .toUpperCase(),
    )
    .filter(Boolean);

/**
 * Whether a car's native detail page (/parts/MAKE/MODEL/STOCK/YEAR) still
 * lists it. Every listed part row carries the car's stock and year as form
 * inputs, and its VIN. Once the car is gone the page has no part rows and
 * renders "No Results.. Try Browsing Our Parts Or Search Again" (Norb's,
 * November 27, 2026: a sold 2006 Lucerne and an unknown stock). Anything else,
 * including the model template's "No Results Found." or part rows for another
 * car, is not evidence either way and throws.
 */
export function urgiisDetailPresence(
  raw: string,
  tenant: UrgiisTenant,
  expected: { stock: string; year: string; vins: readonly string[] },
): "listed" | "gone" {
  const html = iisDocument(raw, tenant);
  const stocks = values(html, "stockno");
  const years = values(html, "yearin");
  if (stocks.length || years.length) {
    const vins = new Set(
      expected.vins.map((v) => v.trim().toUpperCase()).filter(Boolean),
    );
    if (
      !stocks.length ||
      !years.length ||
      stocks.some((s) => s !== expected.stock) ||
      years.some((y) => y !== expected.year) ||
      (vins.size > 0 && pageVins(html).some((vin) => !vins.has(vin)))
    )
      throw new Error(
        `IIS detail page lists stock ${[...new Set(stocks)].join(", ") || "none"}, year ${[...new Set(years)].join(", ") || "none"}, VIN ${[...new Set(pageVins(html))].join(", ") || "none"}; expected stock ${expected.stock}, year ${expected.year}${vins.size ? ", VIN " + [...vins].join(", ") : ""}`,
      );
    return "listed";
  }
  if (
    /No Results\.\.\s*Try Browsing Our Parts Or Search Again/i.test(
      iisText(html),
    )
  )
    return "gone";
  throw new Error(
    "IIS detail page has neither part rows nor its native no-results message",
  );
}

/** The site's image bucket can be shared by several physical yards. Use the
 * native part seller and SKU prefix, never stock prefixes or the site's address. */
export function urgiisDetailSeller(
  raw: string,
  tenant: UrgiisTenant,
  expected: { stock: string; year: string; vin: string },
): string | null {
  const html = iisDocument(raw, tenant);
  if (tenant.attribution.kind !== "seller")
    throw new Error(
      "IIS detail attribution requires qualified seller-to-yard mappings",
    );
  const inputs = [...html.matchAll(/<input\b[^>]*>/gi)].map(([tag]) => tag);
  const values = (name: string) =>
    inputs.flatMap((tag) =>
      iisAttribute(tag, "name") === name
        ? [iisAttribute(tag, "value") ?? ""]
        : [],
    );
  const matches = (name: string, expected: string) => {
    const supplied = values(name);
    return supplied.length > 0 && supplied.every((v) => v === expected);
  };
  if (!matches("stockno", expected.stock) || !matches("yearin", expected.year))
    return null;
  const vins = iisElements(html, "li", (tag) => iisClass(tag, "iispartpagevin"))
    .map(({ body }) =>
      iisText(body)
        .replace(/^VIN\s*:\s*/i, "")
        .trim()
        .toUpperCase(),
    )
    .filter(Boolean);
  if (vins.some((vin) => vin !== expected.vin.trim().toUpperCase()))
    return null;
  const sellers = values("sellingurgid");
  const prefixes = iisElements(html, "li", (tag) =>
    iisClass(tag, "iis-lisku"),
  ).map(({ body }) => {
    const match = iisText(body).match(/^SKU:\s*([A-Z]{2}\d{2})\d+$/);
    return match?.[1] ?? null;
  });
  if (!sellers.length || !prefixes.length || prefixes.some((p) => p === null))
    return null;
  const claims = new Set([...sellers, ...prefixes]);
  const seller = [...claims][0];
  return seller &&
    claims.size === 1 &&
    Object.hasOwn(tenant.attribution.sellerYards, seller)
    ? seller
    : null;
}
