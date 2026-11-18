import { z } from "zod";
import { inventoryCheckpointFingerprint } from "./inventory-checkpoint-fingerprint";
import {
  vanderHaagsCatalogHash,
  type VanderHaagsDonor,
} from "./vanderhaags-catalog";

export const VANDERHAAGS_DAY_MS = 24 * 60 * 60 * 1000;
// Only these native specifications affect the canonical vehicle. Stock, yard,
// title and destination are bound separately by the catalog identity hash.
const detailKeys = [
  "VIN:",
  "Vehicle Info:",
  "Color:",
  "Engine:",
  "Transmission:",
] as const;
export const VanderHaagsEvidenceSchema = z
  .object({
    path: z.string().regex(/^\/detailview\.php\?part=[1-9]\d{0,9}$/),
    identity: z.string().regex(/^[a-f0-9]{64}$/),
    availability: z.enum(["available", "unavailable"]),
    readAt: z.number().int().nonnegative().safe(),
    fields: z
      .array(z.tuple([z.enum(detailKeys), z.string().max(2000)]))
      .max(detailKeys.length),
  })
  .strict()
  .refine(
    (e) => new Set(e.fields.map(([key]) => key)).size === e.fields.length,
    "Vander Haags cached specifications repeat a field",
  );
export type VanderHaagsEvidence = z.infer<typeof VanderHaagsEvidenceSchema>;

export function vanderHaagsDetailEvidence(
  donor: VanderHaagsDonor,
  fields: ReadonlyMap<string, string>,
  now: number,
  availability: "available" | "unavailable",
): VanderHaagsEvidence {
  const retained: VanderHaagsEvidence["fields"] = [];
  for (const key of detailKeys) {
    const value = fields.get(key);
    if (value !== undefined) retained.push([key, value]);
  }
  return {
    path: donor.path,
    availability,
    identity: vanderHaagsCatalogHash([donor]),
    readAt: now,
    fields: retained,
  };
}

// Increment this contract whenever cached detail interpretation changes.
export const VANDERHAAGS_CENSUS_CONTRACT = "detail-census-v1";
const censusBodySchema = z
  .object({
    contract: z.literal(VANDERHAAGS_CENSUS_CONTRACT),
    scope: z.string().regex(/^[a-f0-9]{64}$/),
    startedAt: z.number().int().nonnegative().safe(),
    entries: z.array(VanderHaagsEvidenceSchema).max(10_000),
  })
  .strict();
type CensusBody = z.infer<typeof censusBodySchema>;
function checksum(census: CensusBody) {
  return inventoryCheckpointFingerprint([
    census.contract,
    census.scope,
    census.startedAt,
    census.entries.map((e) => [
      e.path,
      e.identity,
      e.availability,
      e.readAt,
      e.fields,
    ]),
  ]);
}
export const VanderHaagsCensusSchema = censusBodySchema
  .extend({ checksum: z.string().regex(/^[a-f0-9]{8}$/) })
  .refine(
    (c) => c.checksum === checksum(c),
    "Vander Haags census checksum changed",
  )
  .refine(
    (c) =>
      new Set(c.entries.map((e) => e.path)).size === c.entries.length &&
      c.entries.every((e) => e.readAt <= c.startedAt),
    "Vander Haags census repeats a detail or contains future evidence",
  );
export type VanderHaagsCensus = z.infer<typeof VanderHaagsCensusSchema>;
export const VanderHaagsCensus = {
  checkpoint(body: CensusBody): VanderHaagsCensus {
    return VanderHaagsCensusSchema.parse({ ...body, checksum: checksum(body) });
  },
} as const;

/** Six daily ordinal slices fit the six-day carry window. The independent age
 * limit also catches catalog reorderings and reserves a day below seven days. */
export function carryVanderHaagsDetail(
  donor: VanderHaagsDonor,
  index: number,
  previous: VanderHaagsEvidence | undefined,
  now: number,
): VanderHaagsEvidence | undefined {
  if (
    !previous ||
    previous.path !== donor.path ||
    previous.identity !== vanderHaagsCatalogHash([donor])
  )
    return undefined;
  const day = Math.floor(now / VANDERHAAGS_DAY_MS);
  if (
    previous.readAt > now ||
    now - previous.readAt >= 6 * VANDERHAAGS_DAY_MS ||
    (index % 6 === day % 6 &&
      Math.floor(previous.readAt / VANDERHAAGS_DAY_MS) < day)
  )
    return undefined;
  return previous;
}
