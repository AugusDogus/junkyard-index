import { shopifyYardCursor } from "./shopify-yard-cursor";
import {
  MODERNMUSCLE_FEED,
  MODERNMUSCLE_YARD,
} from "./modernmuscle-yard-metadata";
export const ModernmuscleCursor = shopifyYardCursor("modernmuscle", {
  yard: MODERNMUSCLE_YARD,
  catalog: MODERNMUSCLE_FEED,
  floor: 300,
});
export type ModernmuscleCursor = ReturnType<typeof ModernmuscleCursor.initial>;
