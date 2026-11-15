import { Effect } from "effect";
import { z } from "zod";
import {
  decodeHollanderstoresBatch,
  hollanderstoresSeed,
  hollanderstoresAttempt,
  type HollanderstoresProviderError,
} from "./hollanderstores-client";
import { hollanderstoresVin } from "./hollanderstores-vin";

export interface HollanderstoresMakeCache {
  read: (
    vins: readonly string[],
  ) => Effect.Effect<unknown[], HollanderstoresProviderError>;
  write: (
    makes: Readonly<Record<string, string>>,
  ) => Effect.Effect<void, HollanderstoresProviderError>;
}
const makeSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .refine((value) => !/^(?:unknown|none|other|n\/?a|null|0+)$/i.test(value));
export function cachedHollanderstoresMakes(
  vins: readonly string[],
  cache: HollanderstoresMakeCache,
) {
  return Effect.gen(function* () {
    const result: Record<string, string> = {};
    const missing: string[] = [];
    for (const vin of new Set(vins)) {
      if (!hollanderstoresVin(vin)) continue;
      const seeded = hollanderstoresSeed[vin];
      if (seeded) result[vin] = seeded;
      else missing.push(vin);
    }
    for (let offset = 0; offset < missing.length; offset += 50) {
      const batch = missing.slice(offset, offset + 50);
      const cached = yield* cache.read(batch);
      yield* hollanderstoresAttempt(
        "validate persistent VIN make cache",
        () => {
          if (cached.length !== batch.length)
            throw new Error("VIN cache response length changed");
          for (const [index, vin] of batch.entries()) {
            const value = cached[index];
            if (value !== null) result[vin] = makeSchema.parse(value);
          }
        },
      );
    }
    return result;
  });
}
/** Cache successes permanently by VIN. Failed decodes remain rejects and may
 * retry next run. Cache failures fail the chunk instead of re-decoding. */
export function loadHollanderstoresMakes(
  vins: readonly string[],
  cache: HollanderstoresMakeCache,
  decode = decodeHollanderstoresBatch,
) {
  return Effect.gen(function* () {
    yield* hollanderstoresAttempt("make lookup inputs", () => {
      if (
        !vins.length ||
        vins.length > 50 ||
        new Set(vins).size !== vins.length ||
        vins.some((vin) => hollanderstoresVin(vin) !== vin)
      )
        throw new Error("Make lookup requires 1-50 unique valid VINs");
    });
    const cached = yield* cachedHollanderstoresMakes(vins, cache);
    const pending = vins.filter((vin) => !cached[vin]);
    if (!pending.length) return cached;
    const decoded = yield* decode(pending);
    const successes = yield* hollanderstoresAttempt(
      "validate decodes before caching",
      () => {
        if (
          Object.keys(decoded).length !== pending.length ||
          pending.some((vin) => !Object.hasOwn(decoded, vin))
        )
          throw new Error("VIN decoder returned missing or foreign identities");
        const values: Record<string, string> = {};
        for (const vin of pending)
          if (decoded[vin] !== null)
            values[vin] = makeSchema.parse(decoded[vin]);
        return values;
      },
    );
    if (Object.keys(successes).length) yield* cache.write(successes);
    return { ...cached, ...decoded };
  });
}
