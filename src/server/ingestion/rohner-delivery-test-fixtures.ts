import { rohnerFixture } from "./rohner-test-fixtures";
import { ROHNER_CATALOG, ROHNER_ORIGIN } from "./rohner-yard-metadata";

// A smaller protocol scenario uses seven complete frozen native articles and
// eighteen explicitly generated identity variants of one frozen native article.
// Production field parity is checked against the independent full-census oracle.
const escape = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;");
const nativeDonors = [
  "aa0301",
  "aa0304",
  "aa0303",
  "aa0268",
  "aa0279",
  "aa0185",
  "aa0126",
]
  .map(rohnerFixture)
  .map((fixture) => ({
    url: fixture.url,
    html: fixture.html,
    title: fixture.cards[0]?.titles[0] ?? "",
  }));
const base = rohnerFixture("aa0304");
const generatedDonors = Array.from({ length: 18 }, (_, index) => {
  const stock = "AA" + String(400 + index);
  const vin = "ML32A4HJ3FH" + String(100000 + index);
  return {
    url: `${ROHNER_ORIGIN}/shop/${stock.toLowerCase()}/`,
    html: base.html
      .replaceAll("AA0304", stock)
      .replaceAll("aa0304", stock.toLowerCase())
      .replaceAll("ML32A4HJ3FH039866", vin),
    title: (base.cards[0]?.titles[0] ?? "").replaceAll("AA0304", stock),
  };
});
export const rohnerDeliveryDonors = [...nativeDonors, ...generatedDonors];
export const rohnerDeliveryPageUrl = (page: number) =>
  page === 1
    ? ROHNER_CATALOG
    : `${ROHNER_ORIGIN}/shop/page/${page}/?product-categories=vehicles`;

export function rohnerDeliveryCatalog(page: number) {
  const posts = rohnerDeliveryDonors.slice((page - 1) * 24, page * 24);
  const link = (number: number, text: string) =>
    `<a href="${escape(rohnerDeliveryPageUrl(number))}">${text}</a>`;
  return `<!doctype html><html><body>
<p class="woocommerce-result-count">Showing ${(page - 1) * 24 + 1}–${Math.min(page * 24, rohnerDeliveryDonors.length)} of ${rohnerDeliveryDonors.length} results Sorted by latest</p>
<ul class="products">${posts.map((post) => `<li class="product product_cat-vehicles"><a href="${escape(post.url)}"><h2 class="woocommerce-loop-product__title">${escape(post.title)}</h2></a></li>`).join("")}</ul>
<nav class="woocommerce-pagination">${page === 2 ? link(1, "←") + link(1, "1") : ""}<span aria-current="page">${page}</span>${page === 1 ? link(2, "2") + link(2, "→") : ""}</nav>
</body></html>`;
}
