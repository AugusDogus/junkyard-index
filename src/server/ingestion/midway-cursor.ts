import { z } from "zod";
import { inventoryVin } from "./inventory-vin";
import { MIDWAY_MAKE_CONTROL } from "./midway-parser";
import { parseMidwayStockNumber } from "./midway-transform";

const identities = {
  source: z.literal("midway"),
  observedVins: z.array(z.string().min(5).max(17)).max(10_000),
  stocks: z.array(z.string().min(2).max(40)).max(10_000),
};
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const count = z.number().int().min(0).max(10_000);

export const MidwayCursorSchema = z
  .discriminatedUnion("phase", [
    z
      .object({
        ...identities,
        phase: z.literal("yard"),
        yardCode: z.enum(["MO38", "MO09", "OO95"]),
      })
      .strict(),
    // Tulsa make traversal in progress. `makes` are the remaining native make
    // controls from the opening census; an empty list means the closing broad
    // witness is next. `witness` holds opening witness rows not yet reproduced.
    z
      .object({
        ...identities,
        phase: z.literal("tulsa"),
        makes: z.array(z.string().regex(MIDWAY_MAKE_CONTROL)).max(100),
        witness: z.array(hash).max(500),
        openingHash: hash,
        processed: count,
        rejected: count,
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
      (cursor.phase === "yard" && cursor.yardCode === "MO38"
        ? cursor.observedVins.length !== 0 || cursor.stocks.length !== 0
        : cursor.observedVins.length === 0) ||
      (cursor.phase === "tulsa" &&
        (new Set(cursor.makes).size !== cursor.makes.length ||
          new Set(cursor.witness).size !== cursor.witness.length ||
          cursor.rejected > cursor.processed))
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
