import { z } from "zod";

export const RmmdtpRecordSchema = z
  .object({
    id: z.string().regex(/^[1-9]\d{0,11}$/),
    title: z.string().max(2000),
    detailsUrl: z.string().max(1000),
    detailAnchors: z.array(z.string().max(1000)).length(3),
    imageUrl: z.string().max(4096).nullable(),
    fields: z.record(z.string().max(100), z.string().max(10_000)),
  })
  .strict();
export type RmmdtpRecord = z.infer<typeof RmmdtpRecordSchema>;
