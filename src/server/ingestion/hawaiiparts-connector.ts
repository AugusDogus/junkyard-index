import { HawaiipartsCursor } from "./hawaiiparts-cursor";
import {
  HAWAIIPARTS_ORIGIN,
  HAWAIIPARTS_CATALOG,
  HAWAIIPARTS_YARD,
} from "./hawaiiparts-yard-metadata";
import {
  parseHawaiipartsOwner,
  parseHawaiipartsInventory,
} from "./hawaiiparts-parser";
import { shopifyYardReader } from "./shopify-yard-client";
import {
  streamShopifyYard,
  type ShopifyYardOptions,
} from "./shopify-yard-connector";
const readPage = shopifyYardReader(
  "hawaiiparts",
  new Map([
    [HAWAIIPARTS_ORIGIN + "/", "text/html"],
    [HAWAIIPARTS_CATALOG, "text/html"],
  ]),
);
export function streamHawaiipartsInventory<E, R>(
  options: ShopifyYardOptions<E, R>,
) {
  return streamShopifyYard(
    {
      source: "hawaiiparts",
      cursor: HawaiipartsCursor,
      ownerUrl: HAWAIIPARTS_ORIGIN + "/",
      catalogUrl: HAWAIIPARTS_CATALOG,
      yard: HAWAIIPARTS_YARD,
      state: "Hawaii",
      floor: 35,
      readPage,
      parseOwner: parseHawaiipartsOwner,
      parseInventory: parseHawaiipartsInventory,
    },
    options,
  );
}
