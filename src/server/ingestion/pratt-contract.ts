import { z } from "zod";
import type { Yard } from "~/lib/yard";
import { PRATT_ORIGIN } from "./pratt-html";
import { PrattResult } from "./pratt-result";

/** Metadata and the source minimum must come from root qualification, never a
 * sampled page, VIN decode, hidden seller control or an implementation default. */
export const PrattContractSchema = z
  .object({
    yard: z
      .object({
        source: z.literal("pratt"),
        code: z.string().min(1),
        name: z.string().min(1),
        operator: z.string().nullable(),
        address: z.string().min(1),
        city: z.literal("Hoxie"),
        state: z.literal("AR"),
        postalCode: z.string().min(1),
        phone: z.string().nullable(),
        email: z.string().email().nullable(),
        lat: z.number().finite().min(-90).max(90),
        lng: z.number().finite().min(-180).max(180),
        websiteUrl: z.literal(PRATT_ORIGIN + "/"),
      })
      .strict(),
    minimumUniqueInventory: z.number().int().positive(),
  })
  .strict();
export type PrattContract = z.infer<typeof PrattContractSchema>;
export type PrattYard = Omit<Yard, "source"> & { source: "pratt" };
export const PrattContract = {
  schema: PrattContractSchema,
  parse(input: unknown) {
    return PrattResult.boundary("qualification contract", () =>
      PrattContractSchema.parse(input),
    );
  },
} as const;
