import { z } from "zod";

export const AutorecyclerFreshnessSchema = z
  .object({
    asOf: z.number().int().positive(),
    legacy: z.record(z.string().regex(/^\d+x\d+$/), z.number().finite()),
    eligibleYards: z.array(z.string().min(1)).max(1_000),
    // Accumulated by the unfiltered legacy crawl, including stale yards.
    legacyDateEvidence: z.record(z.string(), z.boolean()).optional(),
  })
  .strict();
export type AutorecyclerFreshness = z.infer<typeof AutorecyclerFreshnessSchema>;
