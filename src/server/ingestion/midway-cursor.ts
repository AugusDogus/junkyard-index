import { z } from "zod";
import { inventoryVin } from "./inventory-vin";
import { parseMidwayStockNumber } from "./midway-transform";

export const MidwayCursorSchema = z
  .discriminatedUnion("phase", [
    z
      .object({
        source: z.literal("midway"),
        phase: z.literal("yard"),
        yardCode: z.enum(["MO38", "MO09", "OO95"]),
        observedVins: z.array(z.string().min(5).max(17)).max(10_000),
        stocks: z.array(z.string().min(2).max(40)).max(10_000),
      })
      .strict(),
    z
      .object({ source: z.literal("midway"), phase: z.literal("complete") })
      .strict(),
  ])
  .superRefine((cursor, context) => {
    if (cursor.phase === "complete") return;
    if (
      new Set(cursor.observedVins).size !== cursor.observedVins.length ||
      new Set(cursor.stocks).size !== cursor.stocks.length ||
      cursor.stocks.some((stock) => parseMidwayStockNumber(stock) !== stock) ||
      cursor.observedVins.some(
        (vin) => inventoryVin(vin, vin.length === 17 ? "1981" : "1980") !== vin,
      ) ||
      (cursor.yardCode === "MO38"
        ? cursor.observedVins.length !== 0 || cursor.stocks.length !== 0
        : cursor.observedVins.length === 0)
    )
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Midway checkpoint contains inconsistent yard traversal or observed identities",
      });
  });
export type MidwayCursor = z.infer<typeof MidwayCursorSchema>;
export const MidwayCursor = {
  initial: {
    source: "midway",
    phase: "yard",
    yardCode: "MO38",
    observedVins: [],
    stocks: [],
  },
} as const satisfies { initial: MidwayCursor };
