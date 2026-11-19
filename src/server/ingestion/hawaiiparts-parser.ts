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
/** Strict padded base64 `data-v`, decoded by the page with atob, to an alphanumeric VIN claim. */
function hawaiipartsVin(encoded: string | null): string | null {
  if (
    !encoded ||
    !/^(?:[A-Za-z0-9+/]{4})+(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      encoded,
    )
  )
    return null;
  const vin = Buffer.from(encoded, "base64").toString("latin1");
  return /^[A-Za-z0-9]{1,17}$/.test(vin) ? vin : null;
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
    const reveals = prattElements(body, "button", (t) =>
      prattClass(t, "hp-ycar__vin"),
    );
    const locations = prattElements(body, "span", (t) =>
      prattClass(t, "hp-ycar__loc"),
    );
    const vin = hawaiipartsVin(prattAttribute(tag, "data-v"));
    if (!/^car-\d+$/.test(id))
      throw new Error(
        `Hawaii Parts card anchor "${id}" is not the positional car-N form; the yard markup changed, so no roster is emitted`,
      );
    const reasons: string[] = [];
    if (
      titles.length !== 1 ||
      prattText(titles[0]?.body ?? "") !== `${year} ${make} ${model}`
    )
      reasons.push("conflicting-native-heading");
    // The page reveals exactly this decoded value behind its public "Show VIN" control.
    if (reveals.length !== 1 || vin === null)
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
      vin: vin ?? "",
      year,
      make,
      model,
      status: "active",
      reasons,
      // Positional car-N anchors shift as the roster changes; the page resolves ?car=<vin>.
      detailsUrl:
        vin === null
          ? HAWAIIPARTS_CATALOG + "#" + id
          : HAWAIIPARTS_CATALOG + "?car=" + vin.toLowerCase(),
      imageUrl,
      stockNumber: null,
      color: null,
    });
  });
}
