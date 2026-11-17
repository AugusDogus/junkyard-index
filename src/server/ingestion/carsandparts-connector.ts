import { CarsandpartsCursor } from "./carsandparts-cursor";
import {
  parseCarsandpartsOwner,
  parseCarsandpartsInventory,
} from "./carsandparts-parser";
import {
  CARSANDPARTS_CATALOG,
  CARSANDPARTS_COLLECTION,
  CARSANDPARTS_MINIMUM,
  CARSANDPARTS_YARD,
} from "./carsandparts-yard-metadata";
import { shopifyYardReader } from "./shopify-yard-client";
import {
  streamShopifyYard,
  type ShopifyYardOptions,
} from "./shopify-yard-connector";

const readPage = shopifyYardReader(
  "carsandparts",
  new Map([
    [CARSANDPARTS_COLLECTION, "text/html"],
    [CARSANDPARTS_CATALOG, "application/json"],
  ]),
);
export function streamCarsandpartsInventory<E, R>(
  options: ShopifyYardOptions<E, R>,
) {
  return streamShopifyYard(
    {
      source: "carsandparts",
      cursor: CarsandpartsCursor,
      ownerUrl: CARSANDPARTS_COLLECTION,
      catalogUrl: CARSANDPARTS_CATALOG,
      yard: CARSANDPARTS_YARD,
      state: "New Jersey",
      floor: CARSANDPARTS_MINIMUM,
      readPage,
      parseOwner: parseCarsandpartsOwner,
      parseInventory: parseCarsandpartsInventory,
    },
    options,
  );
}
