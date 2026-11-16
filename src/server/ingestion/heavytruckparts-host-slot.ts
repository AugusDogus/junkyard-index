import { Redis } from "@upstash/redis";
import { Effect } from "effect";

const hostKey = "ingestion:host:heavytruckparts.net:v1";
// Longer than acquisition (5s), bounded request/body/gap (65s), release (5s).
// A crashed instance leaves the host idle until this lease expires.
const leaseMs = 90_000;
export interface HeavyTruckPartsHostStore {
  reserve: (token: string, leaseMs: number) => Promise<boolean>;
  release: (token: string) => Promise<boolean>;
}

const slotError = (operation: string, cause: unknown) =>
  new Error(
    `HTP shared host slot ${operation} failed. Prior inventory and checkpoint remain preserved. Check Upstash Redis before retrying.`,
    { cause },
  );
const storeCall = (operation: string, run: () => Promise<boolean>) =>
  Effect.tryPromise({
    try: run,
    catch: (cause) => slotError(operation, cause),
  }).pipe(
    Effect.timeoutFail({
      duration: "5 seconds",
      onTimeout: () => slotError(operation, "Redis deadline exceeded"),
    }),
  );

/** The caller must include the completed four-second gap inside request.
 * Hold one host lease through that gap, across all suppliers and instances.
 * Never reserve future timestamps that delayed workers could start together.
 */
export function withHeavyTruckPartsHostSlot<A, E, R>(
  store: HeavyTruckPartsHostStore,
  request: Effect.Effect<A, E, R>,
): Effect.Effect<A, E | Error, R> {
  return Effect.uninterruptibleMask((restore) =>
    Effect.gen(function* () {
      const token = crypto.randomUUID();
      yield* restore(
        Effect.gen(function* () {
          while (
            !(yield* storeCall("reservation", () =>
              store.reserve(token, leaseMs),
            ))
          )
            yield* Effect.sleep("4 seconds");
        }).pipe(
          Effect.timeoutFail({
            duration: "2 minutes",
            onTimeout: () => slotError("reservation", "Host remained busy"),
          }),
        ),
      );
      const result = yield* Effect.exit(
        restore(request).pipe(
          Effect.timeoutFail({
            duration: "65 seconds",
            onTimeout: () =>
              slotError("request", "Host lease request deadline exceeded"),
          }),
        ),
      );
      const released = yield* storeCall("release", () => store.release(token));
      if (!released)
        return yield* Effect.fail(
          slotError("release", "Host lease ownership lost"),
        );
      return yield* result;
    }),
  );
}

function configuredStore(): HeavyTruckPartsHostStore {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token)
    throw slotError("configuration", "Missing Upstash Redis URL or token");
  const redis = new Redis({
    url,
    token,
    retry: false,
    signal: () => AbortSignal.timeout(5_000),
  });
  return {
    reserve: async (owner, ttl) =>
      (await redis.set(hostKey, owner, { nx: true, px: ttl })) === "OK",
    release: async (owner) =>
      (await redis.eval(
        "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end",
        [hostKey],
        [owner],
      )) === 1,
  };
}

export function heavyTruckPartsHostSlot<A, E, R>(
  request: Effect.Effect<A, E, R>,
) {
  // Tests and local tools keep the shared in-process semaphore. Every deployed
  // Vercel function (including previews) must use Redis, with no local fallback.
  if (process.env.VERCEL !== "1" && process.env.NODE_ENV !== "production")
    return request;
  return Effect.try({
    try: configuredStore,
    catch: (cause) => slotError("configuration", cause),
  }).pipe(
    Effect.flatMap((store) => withHeavyTruckPartsHostSlot(store, request)),
  );
}
