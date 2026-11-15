import { iisAttribute, iisClass, iisElements, iisText } from "./iis-html";
import { iisDocument } from "./urgiis-catalog";
import type { UrgiisTenant } from "./urgiis-tenant";

/** The site's image bucket can be shared by several physical yards. Use the
 * native part seller and SKU prefix, never stock prefixes or the site's address. */
export function urgiisDetailSeller(
  raw: string,
  tenant: UrgiisTenant,
): string | null {
  const html = iisDocument(raw, tenant);
  if (tenant.attribution.kind !== "seller")
    throw new Error(
      "IIS detail attribution requires qualified seller-to-yard mappings",
    );
  const sellers = [...html.matchAll(/<input\b[^>]*>/gi)].flatMap(([tag]) =>
    iisAttribute(tag, "name") === "sellingurgid"
      ? [iisAttribute(tag, "value") ?? ""]
      : [],
  );
  const prefixes = iisElements(html, "li", (tag) =>
    iisClass(tag, "iis-lisku"),
  ).flatMap(({ body }) => {
    const match = iisText(body).match(/^SKU:\s*([A-Z]{2}\d{2})\d+$/);
    return match?.[1] ? [match[1]] : [];
  });
  const claims = new Set([...sellers, ...prefixes]);
  const seller = [...claims][0];
  return seller &&
    claims.size === 1 &&
    Object.hasOwn(tenant.attribution.sellerYards, seller)
    ? seller
    : null;
}
