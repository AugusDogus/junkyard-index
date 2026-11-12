import { z } from "zod";

export const RTP_PAGE_SIZE = 100;
export const RTP_MAX_YARD_RECORDS = 10_000;
export const RtpYardCodeSchema = z.enum(["595", "1189", "232", "265", "298"]);
export type RtpYardCode = z.infer<typeof RtpYardCodeSchema>;
const source = z.literal("rtp");
export const RtpCursorSchema = z
  .discriminatedUnion("phase", [
    z
      .object({
        source,
        phase: z.literal("start"),
        yardCode: RtpYardCodeSchema,
      })
      .strict(),
    z
      .object({
        source,
        phase: z.literal("page"),
        yardCode: RtpYardCodeSchema,
        offset: z
          .number()
          .int()
          .positive()
          .max(RTP_MAX_YARD_RECORDS)
          .multipleOf(RTP_PAGE_SIZE),
        total: z.number().int().positive().max(RTP_MAX_YARD_RECORDS),
        lastStock: z.string().regex(/^\d{12}$/),
        rejected: z.number().int().nonnegative(),
        excluded: z.number().int().nonnegative(),
        emitted: z.number().int().nonnegative(),
      })
      .strict(),
    z.object({ source, phase: z.literal("complete") }).strict(),
  ])
  .refine(
    (cursor) =>
      cursor.phase !== "page" ||
      (cursor.offset < cursor.total &&
        cursor.rejected + cursor.excluded + cursor.emitted === cursor.offset),
    { message: "RTP cursor counts must account for every preceding record" },
  );
export type RtpCursor = z.infer<typeof RtpCursorSchema>;
export const RtpCursor = {
  initial: { source: "rtp", phase: "start", yardCode: "595" },
} as const satisfies { initial: RtpCursor };
