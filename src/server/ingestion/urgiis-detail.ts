import { iisAttribute, iisClass, iisElements, iisText } from "./iis-html";
import { iisDocument } from "./urgiis-catalog";
import type { UrgiisTenant } from "./urgiis-tenant";

/** The site's image bucket can be shared by several physical yards. Use the
 * native part seller and SKU prefix, never stock prefixes or the site's address. */
export function urgiisDetailSeller(
  raw: string,
  tenant: UrgiisTenant,
  expected: { stock: string; year: string },
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
