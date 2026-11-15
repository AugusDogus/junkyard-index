import { Redis } from "@upstash/redis";
import { Effect } from "effect";
import { env } from "~/env";
import { HollanderstoresProviderError } from "./hollanderstores-client";
import {
  streamHollanderstoresInventory,
  type HollanderstoresOptions,
} from "./hollanderstores-connector";
import {
  cachedHollanderstoresMakes,
  loadHollanderstoresMakes,
  type HollanderstoresMakeCache,
} from "./hollanderstores-make-cache";

const prefix = "hollanderstores:vpic-make:v1:";
/** Step-only transport wiring. Never import into workflow-side cursor modules. */
export function streamHollanderstoresInventoryFromProvider<E, R>(
  options: Omit<
    HollanderstoresOptions<E, R>,
    "decodeBatch" | "readPage" | "loadKnownMakes"
  >,
) {
  const redis = new Redis({
    url: env.UPSTASH_REDIS_REST_URL,
    token: env.UPSTASH_REDIS_REST_TOKEN,
  });
  const cache: HollanderstoresMakeCache = {
    read: (vins) =>
      Effect.tryPromise({
        try: () => redis.mget<unknown[]>(...vins.map((vin) => prefix + vin)),
        catch: (cause) =>
          new HollanderstoresProviderError({
            operation: "load persistent VIN make cache",
            cause,
          }),
      }),
    write: (makes) =>
      Effect.tryPromise({
        try: async () => {
          await redis.mset(
            Object.fromEntries(
              Object.entries(makes).map(([vin, make]) => [prefix + vin, make]),
            ),
          );
        },
        catch: (cause) =>
          new HollanderstoresProviderError({
            operation: "save persistent VIN make cache",
            cause,
          }),
      }),
  };
  return streamHollanderstoresInventory({
    ...options,
    decodeBatch: (vins) => loadHollanderstoresMakes(vins, cache),
    loadKnownMakes: (vins) => cachedHollanderstoresMakes(vins, cache),
  });
}
