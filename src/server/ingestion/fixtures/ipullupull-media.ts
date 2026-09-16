export const beetleImage =
  "https://ipullupull.com/wp-content/uploads/ipullupull-optimized/1b/1b9b8138b8961f0f-large.webp";

export function mediaPage(
  items: {
    stock: string;
    vin: string;
    city: string;
    imageUrl?: string | null;
  }[],
  page = 1,
  total = items.length,
) {
  const attr = (value: string) =>
    value.replaceAll("&", "&amp;").replaceAll('"', "&quot;");
  return `<html><body><section class="ipull-catalog ipull-catalog--inventory" data-slug="inventory-pricing" data-page="${page}" data-total="${total}" data-per-page="96">${items.map((item) => `<article class="ipull-catalog__item" data-stock="${attr(item.stock)}" data-gallery="${attr(JSON.stringify(item.imageUrl === null ? [] : [{ url: item.imageUrl ?? beetleImage }]))}" data-parts="[]"><dl><dt>VIN</dt><dd>${item.vin}</dd><dt>Yard City</dt><dd>${item.city}</dd><dt>Stock #</dt><dd>${item.stock}</dd></dl></article>`).join("")}</section></body></html>`;
}
