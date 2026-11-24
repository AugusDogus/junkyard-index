import { z } from "zod";

const DEFAULT_LIMIT = 1_000_000;
/**
 * Share of the cap held back: index entry counts lag writes, and a copy
 * that lands just under the cap leaves no room for the live index's updates.
 */
const MARGIN_RATIO = 0.02;

const limitSchema = z.coerce.number().int().positive().default(DEFAULT_LIMIT);

/** One index as `listIndices` reports it, for record accounting. */
export interface RecordCapacityListing {
  name: string;
  entries: number;
  /** Virtual replicas share their primary's records. */
  virtual: boolean;
}

/**
 * Whether a full copy of `vehicle` fits beside every other index's records.
 * `needed` is the records the app holds once the copy is loaded; `usable` is
 * the cap less its safety margin.
 */
export type RecordCapacity =
  | {
      kind: "fits";
      entries: number;
      vehicles: number;
      needed: number;
      limit: number;
      usable: number;
    }
  | {
      kind: "over_cap";
      entries: number;
      vehicles: number;
      needed: number;
      limit: number;
      usable: number;
    };

export const RecordCapacity = {
  defaultLimit: DEFAULT_LIMIT,
  marginRatio: MARGIN_RATIO,

  /**
   * The configured cap, ALGOLIA_RECORD_LIMIT. `src/env.js` validates it at
   * boot; it is parsed again here so a build that skips env validation
   * still compares against a number.
   *
   * @throws when ALGOLIA_RECORD_LIMIT is set but not a positive integer.
   */
  limit(raw: unknown = process.env.ALGOLIA_RECORD_LIMIT): number {
    const parsed = limitSchema.safeParse(raw === "" ? undefined : raw);
    if (!parsed.success) {
      throw new Error(
        `ALGOLIA_RECORD_LIMIT must be a positive integer (the Algolia plan's record cap, default ${DEFAULT_LIMIT}); got ${JSON.stringify(raw)}. Fix the environment variable and redeploy; no search index was changed.`,
      );
    }
    return parsed.data;
  },

  /**
   * Accounts for copying every vehicle into a new index. `exclude` names
   * indices whose records do not count (the copy itself, which is cleared
   * before loading).
   */
  forCopy(params: {
    listing: readonly RecordCapacityListing[];
    exclude: readonly string[];
    vehicles: number;
    limit: number;
  }): RecordCapacity {
    const entries = params.listing
      .filter((index) => !index.virtual && !params.exclude.includes(index.name))
      .reduce((total, index) => total + index.entries, 0);
    const needed = entries + params.vehicles;
    const usable = Math.floor(params.limit * (1 - MARGIN_RATIO));
    const fields = {
      entries,
      vehicles: params.vehicles,
      needed,
      limit: params.limit,
      usable,
    };
    return needed > usable
      ? { kind: "over_cap", ...fields }
      : { kind: "fits", ...fields };
  },

  /** States the shortfall for an operator. */
  describe(capacity: RecordCapacity): string {
    return `A full copy needs ${capacity.needed} Algolia records (${capacity.entries} in existing indices plus ${capacity.vehicles} vehicles), and the cap is ${capacity.limit} (${capacity.usable} after the ${MARGIN_RATIO * 100}% safety margin).`;
  },

  /**
   * Whether a QuotaExceeded answer is the record cap, not an operations or
   * search quota, which room for records would not fix.
   */
  isRecordQuota(detail: string): boolean {
    return /record quota/i.test(detail);
  },

  /**
   * States why an in-place rebuild has no room: the live index, the vehicles
   * it is converging to, and every other index holding records.
   */
  describeInPlace(params: {
    listing: readonly RecordCapacityListing[];
    indexName: string;
    vehicles: number;
    limit: number;
  }): string {
    const stored = params.listing.filter((index) => !index.virtual);
    const live =
      stored.find((index) => index.name === params.indexName)?.entries ?? 0;
    const others = stored.filter(
      (index) => index.name !== params.indexName && index.entries > 0,
    );
    const othersText =
      others.length === 0
        ? "no other index holds records"
        : `other indices hold ${others.reduce((total, index) => total + index.entries, 0)} (${others.map((index) => `${index.name}: ${index.entries}`).join(", ")})`;
    return `The live index ${params.indexName} holds ${live} records, Turso has ${params.vehicles} vehicles, ${othersText}, and the cap is ${params.limit}.`;
  },
} as const;
