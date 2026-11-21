import { z } from "zod";
import { AlgoliaFailureTag } from "~/lib/algolia-failure-tag";
import { PLAN_TIERS, type PlanTier } from "~/lib/plans";

/**
 * The Algolia key a browser searches with, minted by the server for one plan
 * tier. `expiresInSeconds` is the key's lifetime from when it was minted. It
 * is a duration, not a timestamp, because the browser's clock can be far
 * from the server's: the browser measures it from when it received the key.
 */
export type SearchKeyGrant = {
  apiKey: string;
  expiresInSeconds: number;
  tier: PlanTier;
};

const schema: z.ZodType<SearchKeyGrant> = z.object({
  apiKey: z.string().min(1),
  expiresInSeconds: z.number().int().nonnegative(),
  tier: z.enum(PLAN_TIERS),
});

/** How long before expiry a browser fetches its next key. */
const RENEW_BEFORE_SECONDS = 5 * 60;

export const SearchKeyGrant = {
  parse(value: unknown): SearchKeyGrant {
    return schema.parse(value);
  },
  /**
   * When, on the browser's own clock, to replace a key it received at
   * `receivedAtMs`. Measured from receipt, so device clock skew cannot make
   * every key look expired, or keep a dead key in use.
   */
  renewAtMs(grant: SearchKeyGrant, receivedAtMs: number): number {
    return (
      receivedAtMs + (grant.expiresInSeconds - RENEW_BEFORE_SECONDS) * 1000
    );
  },
  /**
   * Whether Algolia refused a search because of its key (an expired or
   * invalid secured key: HTTP 403 that is neither a block nor a quota).
   */
  isKeyRejection(error: unknown): boolean {
    const status = AlgoliaFailureTag.statusOf(error);
    return (
      status === 403 &&
      AlgoliaFailureTag.fromAnswer(
        status,
        AlgoliaFailureTag.messageOf(error),
      ) === "InvalidRequest"
    );
  },
} as const;
