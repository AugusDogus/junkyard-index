import { shopifyYardDocument, shopifyYardImage } from "./shopify-yard-html";
import {
  prattAttribute,
  prattClass,
  prattElements,
  prattRegion,
  prattText,
  prattContinuation,
} from "./pratt-html";
import { HAWAIIPARTS_CATALOG } from "./hawaiiparts-yard-metadata";
import { ShopifyYardDonorSchema } from "./shopify-yard-cursor";

export function parseHawaiipartsOwner(raw: string) {
  shopifyYardDocument(raw);
  if (
    !raw.includes('"streetAddress": "91-222 Olai St"') ||
    !raw.includes('"addressLocality": "Kapolei"') ||
    !raw.includes('"addressRegion": "HI"') ||
    !raw.includes('"postalCode": "96707"')
  )
    throw new Error(
      "Hawaii Parts physical Kapolei address changed or disappeared",
    );
}
export function parseHawaiipartsInventory(raw: string) {
  parseHawaiipartsOwner(raw);
  const html = shopifyYardDocument(raw);
  const counts = prattElements(
    html,
    "span",
    (t) => prattAttribute(t, "id") === "hpy-count",
  );
  const total = Number(prattAttribute(counts[0]?.tag ?? "", "data-total"));
  const grid = prattRegion(html, (t) => prattAttribute(t, "id") === "hpy-grid");
  const cards = prattElements(grid, "article", (t) => prattClass(t, "hp-ycar"));
  if (
    counts.length !== 1 ||
    prattText(counts[0]?.body ?? "") !== `${total} cars in the yard` ||
    !total ||
    total > 2000 ||
    cards.length !== total ||
    new Set(cards.map((c) => prattAttribute(c.tag, "id"))).size !== total ||
    prattContinuation(grid).length
  )
    throw new Error(
      "Hawaii Parts complete counted yard roster changed or is truncated",
    );
  return cards.map(({ tag, body }) => {
    const year = prattAttribute(tag, "data-year") ?? "";
    const make = prattAttribute(tag, "data-make") ?? "";
    const model = prattAttribute(tag, "data-model") ?? "";
    const id = prattAttribute(tag, "id") ?? "";
    const titles = prattElements(body, "h2", (t) =>
      prattClass(t, "hp-ycar__t"),
    );
    const vins = prattElements(body, "span", (t) =>
      prattClass(t, "hp-ycar__vin"),
    );
    const locations = prattElements(body, "span", (t) =>
      prattClass(t, "hp-ycar__loc"),
    );
    const vin = prattText(vins[0]?.body ?? "").replace(/^VIN\s+/i, "");
    if (!/^car-[a-z0-9-]+$/.test(id))
      throw new Error("Hawaii Parts donor anchor disappeared");
    const reasons: string[] = [];
    if (
      titles.length !== 1 ||
      prattText(titles[0]?.body ?? "") !== `${year} ${make} ${model}`
    )
      reasons.push("conflicting-native-heading");
    if (vins.length !== 1 || id !== `car-${vin.toLowerCase()}`)
      reasons.push("conflicting-native-identity");
    if (
      locations.length !== 1 ||
      prattText(locations[0]?.body ?? "") !== "📍 Kapolei, Oahu"
    )
      reasons.push("unverified-physical-yard");
    const image = /<img\b[^>]*>/i.exec(body)?.[0];
    const imageUrl = shopifyYardImage(
      image ? prattAttribute(image, "src") : null,
      ["cdn.shopify.com", "aloha.parts"],
    );
    return ShopifyYardDonorSchema.parse({
      id,
      vin,
      year,
      make,
      model,
      status: "active",
      reasons,
      detailsUrl: HAWAIIPARTS_CATALOG + "#" + id,
      imageUrl,
      stockNumber: null,
      color: null,
    });
  });
}
