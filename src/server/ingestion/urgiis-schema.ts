import { z } from "zod";
export const UrgiisControlSchema = z
  .object({
    path: z.string().min(1).max(1000),
    label: z.string().min(1).max(200),
    count: z.number().int().nonnegative(),
  })
  .strict();
export type UrgiisControl = z.infer<typeof UrgiisControlSchema>;
export const UrgiisRecordSchema = z
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
export type UrgiisRecord = z.infer<typeof UrgiisRecordSchema>;
export interface UrgiisSite {
  origin: string;
  urgid: string;
  pathStyle: "parts" | "used-parts";
}
