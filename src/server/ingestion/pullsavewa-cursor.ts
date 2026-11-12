import { z } from "zod";
import { inventoryVin } from "./inventory-vin";
import { PULLSAVEWA_MAX_RECORDS } from "./pullsavewa-parser";
import { SourceValidationPolicy } from "./source-validation";

const count = z.number().int().min(0).max(PULLSAVEWA_MAX_RECORDS);
export const PullsavewaCursorSchema = z
  .discriminatedUnion("phase", [
    z
      .object({ source: z.literal("pullsavewa"), phase: z.literal("start") })
      .strict(),
    z
      .object({
        source: z.literal("pullsavewa"),
        phase: z.literal("yards"),
        nextYard: z.literal(1),
        processed: count,
        emitted: count,
        rejected: count,
        vins: z
          .array(z.string().min(5).max(17))
          .min(1)
          .max(PULLSAVEWA_MAX_RECORDS),
      })
      .strict(),
    z
      .object({ source: z.literal("pullsavewa"), phase: z.literal("complete") })
      .strict(),
  ])
  .superRefine((cursor, context) => {
    if (cursor.phase !== "yards") return;
    if (
      cursor.emitted < 1 ||
      cursor.processed !== cursor.emitted + cursor.rejected ||
      cursor.rejected / cursor.processed >
        SourceValidationPolicy.maximumRejectionRatio ||
      cursor.vins.length < cursor.emitted ||
      cursor.vins.length > cursor.processed ||
      new Set(cursor.vins).size !== cursor.vins.length ||
      cursor.vins.some(
        (vin) => inventoryVin(vin, vin.length === 17 ? "1981" : "1980") !== vin,
      )
    )
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Pull & Save checkpoint identities or per-yard accounting are inconsistent; retain the last validated checkpoint",
      });
  });
export type PullsavewaCursor = z.infer<typeof PullsavewaCursorSchema>;
export const PullsavewaCursor = {
  initial: { source: "pullsavewa", phase: "start" },
} as const satisfies { initial: PullsavewaCursor };
