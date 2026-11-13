import { z } from "zod";
import type { Yard } from "~/lib/yard";
import { CARS4PARTS_ORIGIN } from "./cars4parts-html";
import { Cars4PartsResult } from "./cars4parts-result";

const yard = z.object({
  source: z.literal("cars4parts"),
  name: z.string().min(1),
  operator: z.string().nullable(),
  address: z.string().min(1),
  state: z.literal("IL"),
  postalCode: z.string().min(1),
  phone: z.string().nullable(),
  email: z.string().email().nullable(),
  lat: z.number().finite().min(-90).max(90),
  lng: z.number().finite().min(-180).max(180),
  websiteUrl: z.literal(CARS4PARTS_ORIGIN + "/"),
});
/** Root supplies physical metadata and complete-census minima. Neither a parser
 * canary nor an opening result page is a qualification floor. */
export const Cars4PartsContractSchema = z
  .object({
    heyworth: z
      .object({
        yard: yard
          .extend({ code: z.literal("heyworth"), city: z.literal("Heyworth") })
          .strict(),
        minimumUniqueInventory: z.number().int().positive(),
      })
      .strict(),
    armington: z
      .object({
        yard: yard
          .extend({
            code: z.literal("armington"),
            city: z.literal("Armington"),
          })
          .strict(),
        minimumUniqueInventory: z.number().int().positive(),
      })
      .strict(),
  })
  .strict();
export type Cars4PartsContract = z.infer<typeof Cars4PartsContractSchema>;
export type Cars4PartsYard = Omit<Yard, "source"> & { source: "cars4parts" };
export const Cars4PartsContract = {
  schema: Cars4PartsContractSchema,
  parse(input: unknown) {
    return Cars4PartsResult.boundary("qualification contract", () =>
      Cars4PartsContractSchema.parse(input),
    );
  },
} as const;
