import { z } from "zod";
import { PLAN_TIERS, type PlanTier } from "~/lib/plans";

/**
 * The Algolia key a browser searches with, minted by the server for one plan
 * tier. `validUntil` is in seconds since the Unix epoch, as Algolia reads it.
 */
export type SearchKeyGrant = {
  apiKey: string;
  validUntil: number;
  tier: PlanTier;
};

const schema: z.ZodType<SearchKeyGrant> = z.object({
  apiKey: z.string().min(1),
  validUntil: z.number().int().positive(),
  tier: z.enum(PLAN_TIERS),
});

/** How long before expiry a browser fetches its next key. */
const RENEW_BEFORE_SECONDS = 5 * 60;

export const SearchKeyGrant = {
  parse(value: unknown): SearchKeyGrant {
    return schema.parse(value);
  },
  /** Whether the key should be replaced before the next search. */
  isExpiring(grant: SearchKeyGrant, nowMs: number): boolean {
    return grant.validUntil - RENEW_BEFORE_SECONDS <= nowMs / 1000;
  },
} as const;
