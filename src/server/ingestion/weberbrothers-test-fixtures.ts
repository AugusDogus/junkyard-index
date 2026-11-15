import { WEBERBROTHERS_CATALOG } from "./weberbrothers-yard-metadata";
import type {
  WeberbrothersPost,
  WeberbrothersRecord,
} from "./weberbrothers-parser";
import { parseWeberbrothersDetail } from "./weberbrothers-parser";

// Reduced native markup for isolated behavioral tests. Full qualification uses
// the separately preserved HTTP response bodies, not these fixtures.
export const weberbrothersFixturePost: WeberbrothersPost = {
  url: "https://www.weberbrothersauto.com/product/2025-nissan-murano-b2b370/",
  title: "2025 NISSAN MURANO SV",
  stock: "B2B370",
  nativePostId: "1908003",
};
export function weberbrothersFixtureDocument(body: string) {
  return `<html><body>${body}<footer>Weber Brothers Auto 1325 East Main Street<br>Unit 1<br>Annville, PA 17003-1612</footer></body></html><!-- native cache footer -->`;
}
export function weberbrothersFixtureListing(
  posts: WeberbrothersPost[] = [weberbrothersFixturePost],
) {
  return weberbrothersFixtureDocument(
    `<div class="products-loop">${posts
      .map(
        (post) =>
          `<div class="product-loop-item product post-${post.nativePostId} product_cat-vehicles"><div class="title"><a href="${post.url}">${post.title}</a></div><div class="sku">Stock #: ${post.stock}</div><a href="${post.url}">View Vehicle</a></div>`,
      )
      .join(
        "",
      )}</div><nav class="woocommerce-pagination"><span aria-current="page">1</span></nav>`,
  );
}
export function weberbrothersFixtureDetail(
  post: WeberbrothersPost = weberbrothersFixturePost,
  options: {
    vin?: string;
    comments?: string;
    grouped?: boolean;
    color?: string;
    arrival?: string;
  } = {},
) {
  return weberbrothersFixtureDocument(`<div class="product product_cat-vehicles post-${post.nativePostId} product-type-${options.grouped === false ? "simple" : "grouped"}" id="product-${post.nativePostId}">
    <div class="woocommerce-product-gallery"><a href="https://weberbrothersauto.s3.amazonaws.com/2026/11/${post.stock}-1.jpg"><img src="https://weberbrothersauto.s3.amazonaws.com/2026/11/${post.stock}-1.jpg"></a></div>
    <div class="summary"><h1 class="product_title">${post.title}</h1><div class="sku"><strong>Stock Number:</strong> ${post.stock}</div><div class="attr-box">
    <div class="attr"><strong>VIN:</strong> ${options.vin ?? "5N1AZ3BS4SC111240"}</div>
    <div class="attr"><strong>Comments:</strong> ${options.comments ?? "SV 2.0L Turbo All Wheel Drive Auto"}</div>
    <div class="attr"><strong>Exterior:</strong></div><div class="attr sub"><strong>Color:</strong> ${options.color ?? "Super Black"}</div>
    <div class="attr"><strong>Interior:</strong></div><div class="attr sub"><strong>Color:</strong> Gray</div>
    <div class="attr"><strong>Arrival Date:</strong> ${options.arrival ?? "11/13/2026"}</div>
    </div></div><div class="product"><h1>Component 2026 MODEL</h1><div>VIN: WRONG PART STOCK</div></div></div>`);
}
export function weberbrothersFixtureRecord(
  post: WeberbrothersPost = weberbrothersFixturePost,
  options: Parameters<typeof weberbrothersFixtureDetail>[1] = {},
): WeberbrothersRecord {
  return parseWeberbrothersDetail(
    weberbrothersFixtureDetail(post, options),
    post,
  );
}
export const weberbrothersFixtureRoot = WEBERBROTHERS_CATALOG;
