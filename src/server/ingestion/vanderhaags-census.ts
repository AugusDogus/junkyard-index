import { z } from "zod";
import { inventoryCheckpointFingerprint } from "./inventory-checkpoint-fingerprint";
import {
  vanderHaagsCatalogHash,
  type VanderHaagsDonor,
} from "./vanderhaags-catalog";

export const VANDERHAAGS_DAY_MS = 24 * 60 * 60 * 1000;
export const VANDERHAAGS_SWEEP_DAYS = 30;
export const VANDERHAAGS_DAILY_REVERIFICATION_LIMIT = 100;
const detailPathSchema = z
  .string()
  .regex(/^\/detailview\.php\?part=[1-9]\d{0,9}$/);
const reverificationSchema = z
  .object({
    day: z.number().int().nonnegative().safe(),
    // Reserve reads before fetching so every checkpoint shares the same budget.
    paths: z
      .array(detailPathSchema)
      .max(VANDERHAAGS_DAILY_REVERIFICATION_LIMIT),
  })
  .strict()
  .refine(
    (r) => new Set(r.paths).size === r.paths.length,
    "Vander Haags daily re-verification budget repeats a path",
  );
type Reverification = z.infer<typeof reverificationSchema>;
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
    path: detailPathSchema,
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
export const VANDERHAAGS_CENSUS_CONTRACT = "detail-census-v2";
const censusBodySchema = z
  .object({
    contract: z.literal(VANDERHAAGS_CENSUS_CONTRACT),
    scope: z.string().regex(/^[a-f0-9]{64}$/),
    startedAt: z.number().int().nonnegative().safe(),
    reverification: reverificationSchema,
    entries: z.array(VanderHaagsEvidenceSchema).max(10_000),
  })
  .strict();
type CensusBody = z.infer<typeof censusBodySchema>;
function checksum(census: CensusBody) {
  return inventoryCheckpointFingerprint([
    census.contract,
    census.scope,
    census.startedAt,
    census.reverification,
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
      c.entries.every((e) => e.readAt <= c.startedAt) &&
      c.reverification.day === Math.floor(c.startedAt / VANDERHAAGS_DAY_MS),
    "Vander Haags census repeats a detail, contains future evidence or has a mismatched daily budget",
  );
export type VanderHaagsCensus = z.infer<typeof VanderHaagsCensusSchema>;
export const VanderHaagsCensus = {
  checkpoint(body: CensusBody): VanderHaagsCensus {
    return VanderHaagsCensusSchema.parse({ ...body, checksum: checksum(body) });
  },
} as const;

/** Catalog identity changes always require a read, independently of the sweep. */
export function carryVanderHaagsDetail(
  donor: VanderHaagsDonor,
  previous: VanderHaagsEvidence | undefined,
  now: number,
): VanderHaagsEvidence | undefined {
  if (
    !previous ||
    previous.path !== donor.path ||
    previous.identity !== vanderHaagsCatalogHash([donor]) ||
    previous.readAt > now
  )
    return undefined;
  return previous;
}

/** A monthly ordinal slice starts the sweep immediately after bootstrap.
 * Oldest overdue evidence wins when missed runs or reordering create a backlog.
 * The cap takes precedence over age, so a backlog never forces a full census. */
export function planVanderHaagsReverification(
  donors: readonly VanderHaagsDonor[],
  entries: ReadonlyMap<string, VanderHaagsEvidence>,
  previous: Reverification,
  now: number,
): Reverification {
  const day = Math.floor(now / VANDERHAAGS_DAY_MS);
  const reserved = new Set(previous.day === day ? previous.paths : []);
  const due = donors
    .flatMap((donor, index) => {
      const evidence = carryVanderHaagsDetail(
        donor,
        entries.get(donor.path),
        now,
      );
      if (
        !evidence ||
        reserved.has(donor.path) ||
        Math.floor(evidence.readAt / VANDERHAAGS_DAY_MS) === day ||
        (now - evidence.readAt < VANDERHAAGS_SWEEP_DAYS * VANDERHAAGS_DAY_MS &&
          index % VANDERHAAGS_SWEEP_DAYS !== day % VANDERHAAGS_SWEEP_DAYS)
      )
        return [];
      return [evidence];
    })
    .sort((a, b) => a.readAt - b.readAt || a.path.localeCompare(b.path));
  return {
    day,
    paths: [
      ...reserved,
      ...due
        .slice(0, VANDERHAAGS_DAILY_REVERIFICATION_LIMIT - reserved.size)
        .map((e) => e.path),
    ],
  };
}
