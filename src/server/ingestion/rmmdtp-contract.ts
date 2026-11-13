import { z } from "zod";
import type { Yard } from "~/lib/yard";
import { RMMDTP_ORIGIN } from "./rmmdtp-html";
import { RmmdtpResult } from "./rmmdtp-result";

export const RmmdtpContractSchema = z
  .object({
    yard: z
      .object({
        source: z.literal("rmmdtp"),
        code: z.literal("corinne"),
        name: z.string().min(1),
        operator: z.string().nullable(),
        address: z.string().min(1),
        city: z.literal("Corinne"),
        state: z.literal("UT"),
        postalCode: z.string().min(1),
        phone: z.string().nullable(),
        email: z.string().email().nullable(),
        lat: z.number().finite().min(-90).max(90),
        lng: z.number().finite().min(-180).max(180),
        websiteUrl: z.literal(RMMDTP_ORIGIN + "/"),
      })
      .strict(),
    minimumUniqueInventory: z.number().int().positive(),
  })
  .strict();
export type RmmdtpContract = z.infer<typeof RmmdtpContractSchema>;
export type RmmdtpYard = Omit<Yard, "source"> & { source: "rmmdtp" };
export const RmmdtpContract = {
  schema: RmmdtpContractSchema,
  parse: (input: unknown) =>
    RmmdtpResult.boundary("qualification contract", () =>
      RmmdtpContractSchema.parse(input),
    ),
} as const;
