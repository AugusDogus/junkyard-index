import { z } from "zod";

export const NvpapYardCodeSchema = z.enum(["1074", "1075"]);
export type NvpapYardCode = z.infer<typeof NvpapYardCodeSchema>;
export const NVPAP_FIRST_YEAR = 1886;
export const NVPAP_LAST_YEAR = 2100;
export const NVPAP_RESULT_CAP = 200;

const count = z.number().int().nonnegative().max(50_000);
export const NvpapCursorSchema = z
  .discriminatedUnion("phase", [
    z
      .object({
        source: z.literal("nvpap"),
        phase: z.literal("start"),
        yardCode: NvpapYardCodeSchema,
      })
      .strict(),
    z
      .object({
        source: z.literal("nvpap"),
        phase: z.literal("year"),
        yardCode: NvpapYardCodeSchema,
        year: z.number().int().min(NVPAP_FIRST_YEAR).max(NVPAP_LAST_YEAR),
        // Broad controls prove the partitions retain independently observed donors.
        pending: z.array(z.string().min(1).max(208)).max(NVPAP_RESULT_CAP),
        processed: count,
        rejected: count,
        emitted: count,
      })
      .strict(),
    z
      .object({
        source: z.literal("nvpap"),
        phase: z.literal("complete"),
      })
      .strict(),
  ])
  .refine(
    (cursor) =>
      cursor.phase !== "year" ||
      (cursor.rejected + cursor.emitted === cursor.processed &&
        cursor.processed <=
          (cursor.year - NVPAP_FIRST_YEAR) * (NVPAP_RESULT_CAP - 1) &&
        new Set(cursor.pending).size === cursor.pending.length &&
        cursor.pending.every((key) =>
          key.startsWith(cursor.yardCode === "1074" ? "L" : "H"),
        ) &&
        (cursor.year !== NVPAP_FIRST_YEAR || cursor.pending.length > 0)),
    {
      message:
        "Nevada cursor counts and controls must match the yard and preceding year queries",
    },
  );
export type NvpapCursor = z.infer<typeof NvpapCursorSchema>;
export const NvpapCursor = {
  initial: { source: "nvpap", phase: "start", yardCode: "1074" },
} as const satisfies { initial: NvpapCursor };
