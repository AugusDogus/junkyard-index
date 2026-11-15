import { shopifyYardCursor } from "./shopify-yard-cursor";
import {
  HAWAIIPARTS_CATALOG,
  HAWAIIPARTS_YARD,
} from "./hawaiiparts-yard-metadata";
export const HawaiipartsCursor = shopifyYardCursor("hawaiiparts", {
  yard: HAWAIIPARTS_YARD,
  catalog: HAWAIIPARTS_CATALOG,
  floor: 35,
});
export type HawaiipartsCursor = ReturnType<typeof HawaiipartsCursor.initial>;
