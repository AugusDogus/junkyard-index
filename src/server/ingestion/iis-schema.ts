import { z } from "zod";

export const IisControlSchema = z
  .object({
    path: z.string().max(500),
    label: z.string().max(200),
    count: z.number().int().nonnegative(),
  })
  .strict();
export type IisControl = z.infer<typeof IisControlSchema>;
export const IisContextSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("model"),
      make: IisControlSchema,
      model: IisControlSchema,
    })
    .strict(),
  z.object({ kind: z.literal("arrivals") }).strict(),
]);
export type IisContext = z.infer<typeof IisContextSchema>;
export const IisRecordSchema = z
  .object({
    years: z.array(z.string()),
    titles: z.array(z.string()),
    vins: z.array(z.string()),
    inquiries: z.array(z.string()),
    destinations: z.array(z.string()),
    stock: z.string().nullable(),
    image: z.string().nullable(),
    date: z.string().nullable(),
  })
  .strict();
export type IisRecord = z.infer<typeof IisRecordSchema>;
