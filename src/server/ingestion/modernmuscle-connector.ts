import { ModernmuscleCursor } from "./modernmuscle-cursor";
import {
  MODERNMUSCLE_CONTACT,
  MODERNMUSCLE_FEED,
  MODERNMUSCLE_YARD,
} from "./modernmuscle-yard-metadata";
import {
  parseModernmuscleOwner,
  parseModernmuscleInventory,
} from "./modernmuscle-parser";
import { shopifyYardReader } from "./shopify-yard-client";
import {
  streamShopifyYard,
  type ShopifyYardOptions,
} from "./shopify-yard-connector";
const readPage = shopifyYardReader(
  "modernmuscle",
  new Map([
    [MODERNMUSCLE_CONTACT, "text/html"],
    [MODERNMUSCLE_FEED, "application/json"],
  ]),
);
export function streamModernmuscleInventory<E, R>(
  options: ShopifyYardOptions<E, R>,
) {
  return streamShopifyYard(
    {
      source: "modernmuscle",
      cursor: ModernmuscleCursor,
      ownerUrl: MODERNMUSCLE_CONTACT,
      catalogUrl: MODERNMUSCLE_FEED,
      yard: MODERNMUSCLE_YARD,
      state: "Michigan",
      floor: 115,
      readPage,
      parseOwner: parseModernmuscleOwner,
      parseInventory: parseModernmuscleInventory,
    },
    options,
  );
}
