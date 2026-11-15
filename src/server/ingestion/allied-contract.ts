import { z } from "zod";
import type { Yard } from "~/lib/yard";
import { ALLIED_ORIGIN } from "./allied-html";
import { AlliedResult } from "./allied-result";

/** Metadata and the source minimum must come from root qualification, never a
 * sampled page, VIN decode, hidden seller control or an implementation default. */
export const AlliedContractSchema = z
  .object({
    yard: z
      .object({
        source: z.literal("allied"),
        code: z.string().min(1),
        name: z.string().min(1),
        operator: z.string().nullable(),
        address: z.string().min(1),
        city: z.literal("Weare"),
        state: z.literal("NH"),
        postalCode: z.string().min(1),
        phone: z.string().nullable(),
        email: z.string().email().nullable(),
        lat: z.number().finite().min(-90).max(90),
        lng: z.number().finite().min(-180).max(180),
        websiteUrl: z.literal(ALLIED_ORIGIN + "/"),
      })
      .strict(),
    minimumUniqueInventory: z.number().int().positive(),
  })
  .strict();
export type AlliedContract = z.infer<typeof AlliedContractSchema>;
export type AlliedYard = Omit<Yard, "source"> & { source: "allied" };
export const AlliedContract = {
  schema: AlliedContractSchema,
  parse(input: unknown) {
    return AlliedResult.boundary("qualification contract", () =>
      AlliedContractSchema.parse(input),
    );
  },
} as const;
