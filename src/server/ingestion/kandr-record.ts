import { z } from "zod";
import { KANDR_MAX_BODY_BYTES } from "./kandr-native";

const category = z.enum(["99994", "99992"]);
const fields = z.record(z.string(), z.array(z.string()).max(64));
const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const KandrListingSchema = z
  .object({
    url: z.string(),
    category,
    page: z.number().int().positive().max(400),
    total: z.number().int().positive().max(10000),
    lastPage: z.number().int().positive().max(400),
    nextUrl: z.string().nullable(),
    cards: z
      .array(
        z
          .object({
            id: z.string(),
            url: z.string(),
            titles: z.array(z.string()).length(2),
            fields,
          })
          .strict(),
      )
      .min(1)
      .max(25),
    fingerprint: hash,
  })
  .strict();
export const KandrDetailSchema = z
  .object({
    id: z.string(),
    url: z.string(),
    category,
    title: z.string(),
    fields,
    descriptions: z.array(z.string()).max(1024),
    images: z.array(z.string()).max(256),
  })
  .strict();
const evidence = {
  bodyHash: hash,
  bytes: z.number().int().positive().max(KANDR_MAX_BODY_BYTES),
};
export const KandrReceiptSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("controls"),
      ...evidence,
      urls: z.array(z.string()).length(2),
    })
    .strict(),
  z
    .object({
      kind: z.enum(["listing", "closing"]),
      ...evidence,
      page: KandrListingSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("detail"),
      ...evidence,
      detail: KandrDetailSchema,
    })
    .strict(),
]);
export type KandrReceipt = z.infer<typeof KandrReceiptSchema>;
