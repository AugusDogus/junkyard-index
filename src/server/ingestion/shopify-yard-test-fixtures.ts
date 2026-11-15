import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
export function shopifyYardFixture(
  name:
    | "hawaiiparts-yard-html"
    | "hawaiiparts-home"
    | "modernmuscle-contact"
    | "modernmuscle-page-html"
    | "modernmuscle-feed"
    | "hawaiiparts-geocode"
    | "modernmuscle-geocode"
    | "lachance-products",
) {
  return gunzipSync(
    readFileSync(
      new URL(`./shopify-yard-test-fixtures/${name}.gz`, import.meta.url),
    ),
  ).toString();
}
