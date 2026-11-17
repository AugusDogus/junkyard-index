import { shopifyYardCursor } from "./shopify-yard-cursor";
import {
  CARSANDPARTS_CATALOG,
  CARSANDPARTS_YARD,
  CARSANDPARTS_MINIMUM,
} from "./carsandparts-yard-metadata";

export const CarsandpartsCursor = shopifyYardCursor("carsandparts", {
  yard: CARSANDPARTS_YARD,
  catalog: CARSANDPARTS_CATALOG,
  floor: CARSANDPARTS_MINIMUM,
});
export type CarsandpartsCursor = ReturnType<typeof CarsandpartsCursor.initial>;
