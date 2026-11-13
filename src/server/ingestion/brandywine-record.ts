import { z } from "zod";
import {
  BrandywineBodySchema,
  BrandywineReceiptSchema,
} from "./brandywine-html";
import { BrandywineBindingSchema } from "./brandywine-catalog";

export const BrandywineCandidateSchema = z
  .object({
    vin: z.string().min(5).max(17),
    year: z.number().int().min(1886).max(2100),
    make: z.string().min(1).max(100),
    model: z.string().min(1).max(200),
    stockNumber: z.string().min(1).max(16),
    color: z.string().nullable(),
    row: z.string().nullable(),
    availableDate: z.string().nullable(),
    detailsUrl: z.string().max(512),
  })
  .strict();
export type BrandywineCandidate = z.infer<typeof BrandywineCandidateSchema>;
export const BrandywineDetailSchema = z
  .object({
    url: z.string().max(512),
    body: BrandywineBodySchema,
    receipt: BrandywineReceiptSchema,
    headings: z.array(z.string().max(200)).max(20),
    titles: z.array(z.string().max(200)).max(10),
    fields: z
      .array(
        z
          .object({ label: z.string().max(100), value: z.string().max(200) })
          .strict(),
      )
      .max(100),
    destinations: z.array(z.string().max(512)).max(20),
    boundaryErrors: z.array(z.string().max(200)).max(20),
  })
  .strict();
export type BrandywineDetail = z.infer<typeof BrandywineDetailSchema>;
const common = {
  raw: BrandywineDetailSchema,
  bindings: z.array(BrandywineBindingSchema).max(100),
  validVinClaims: z.array(z.string().max(17)).max(100),
  claimedDestinations: z.array(z.string().max(512)).max(120),
  marker: z.string().max(200),
  reasons: z.array(z.string().max(200)),
};
export const BrandywineRecordSchema = z.discriminatedUnion("status", [
  z
    .object({
      ...common,
      status: z.literal("required-pass"),
      candidate: BrandywineCandidateSchema,
    })
    .strict(),
  z
    .object({
      ...common,
      status: z.enum([
        "boundary-unknown",
        "identity-conflict",
        "required-reject",
      ]),
      candidate: z.null(),
    })
    .strict(),
]);
export type BrandywineRecord = z.infer<typeof BrandywineRecordSchema>;
