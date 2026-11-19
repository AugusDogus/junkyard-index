import { Redis } from "@upstash/redis";
import { Effect } from "effect";

export interface ProviderHostStore {
  reserve(token: string, leaseMs: number): Promise<boolean>;
  release(token: string): Promise<boolean>;
  cancel(token: string): Promise<boolean>;
}
export interface ProviderHostPolicy {
  key: string;
  label: string;
  leaseMs: number;
  requestMs: number;
  waitMs: number;
  pollMs: number;
  gapMs: number;
}

const slotError = (
  policy: ProviderHostPolicy,
  operation: string,
  cause: unknown,
) =>
  new Error(
    `${policy.label} shared host slot ${operation} failed. Prior inventory and checkpoint remain preserved. Check Upstash Redis before retrying.`,
    { cause },
  );

/** The FIFO wait ended before this worker reached the lease. Nothing was
 * requested from the host; callers may defer instead of failing. */
export class ProviderHostBusyError extends Error {
  readonly tag = "ProviderHostBusyError";
  constructor(
    readonly policyKey: string,
    label: string,
  ) {
    super(
      `${label} shared host slot reservation failed: Host remained busy for the whole wait, so no request was sent. Prior inventory and checkpoint remain preserved; retry once the other worker releases the slot.`,
    );
  }
}

/** Atomic FIFO registration and acquisition. Polls renew the waiter's deadline
 * without changing its order. Dead workers expire instead of blocking the queue.
 * All keys share one Redis hash tag for cluster-safe scripts. */
export const RESERVE_HOST_SLOT = `
local now = redis.call('TIME')
local ms = now[1] * 1000 + math.floor(now[2] / 1000)
local expired = redis.call('ZRANGEBYSCORE', KEYS[3], '-inf', ms)
for _, token in ipairs(expired) do
  redis.call('ZREM', KEYS[2], token)
  redis.call('ZREM', KEYS[3], token)
end
if not redis.call('ZSCORE', KEYS[2], ARGV[1]) then
  redis.call('ZADD', KEYS[2], redis.call('INCR', KEYS[4]), ARGV[1])
end
redis.call('ZADD', KEYS[3], ms + 30000, ARGV[1])
redis.call('PEXPIRE', KEYS[2], 60000)
redis.call('PEXPIRE', KEYS[3], 60000)
redis.call('PEXPIRE', KEYS[4], 60000)
if redis.call('ZRANGE', KEYS[2], 0, 0)[1] ~= ARGV[1] then return 0 end
if not redis.call('SET', KEYS[1], ARGV[1], 'NX', 'PX', ARGV[2]) then return 0 end
redis.call('ZREM', KEYS[2], ARGV[1])
redis.call('ZREM', KEYS[3], ARGV[1])
return 1
`;

export function redisProviderHostStore(
  policy: ProviderHostPolicy,
  redis: Pick<Redis, "eval">,
): ProviderHostStore {
  // Keep the existing HTP lease key during rolling deployments. Hash-tag
  // queue keys with its complete name so all scripts use the same cluster slot.
  const key = `ingestion:host:${policy.key}:v1`;
  const queue = `{${key}}:queue`;
  const deadlines = `{${key}}:deadlines`;
  return {
    reserve: async (owner, ttl) =>
      (await redis.eval(
        RESERVE_HOST_SLOT,
        [key, queue, deadlines, `{${key}}:sequence`],
        [owner, ttl],
      )) === 1,
    release: async (owner) =>
      (await redis.eval(
        "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end",
        [key],
        [owner],
      )) === 1,
    cancel: async (owner) => {
      // A timed-out Redis response may have acquired the lease. Keep that
      // lease until expiry; cancellation removes only its queued registration.
      await redis.eval(
        "redis.call('ZREM', KEYS[1], ARGV[1]); redis.call('ZREM', KEYS[2], ARGV[1]); return 1",
        [queue, deadlines],
        [owner],
      );
      return true;
    },
  };
}

export function withProviderHostSlot<A, E, R>(
  policy: ProviderHostPolicy,
  store: ProviderHostStore,
  request: Effect.Effect<A, E, R>,
): Effect.Effect<A, E | Error, R> {
  const call = (operation: string, run: () => Promise<boolean>) =>
    Effect.tryPromise({
      try: run,
      catch: (cause) => slotError(policy, operation, cause),
    }).pipe(
      Effect.timeoutFail({
        duration: "5 seconds",
        onTimeout: () =>
          slotError(policy, operation, "Redis deadline exceeded"),
      }),
    );
  return Effect.uninterruptibleMask((restore) =>
    Effect.gen(function* () {
      const token = crypto.randomUUID();
      const acquired = yield* Effect.exit(
        restore(
          Effect.gen(function* () {
            while (
              !(yield* call("reservation", () =>
                store.reserve(token, policy.leaseMs),
              ))
            )
              yield* Effect.sleep(policy.pollMs);
          }).pipe(
            Effect.timeoutFail({
              duration: policy.waitMs,
              onTimeout: () =>
                new ProviderHostBusyError(policy.key, policy.label),
            }),
          ),
        ),
      );
      if (acquired._tag === "Failure") {
        yield* call("queue cancellation", () => store.cancel(token));
        return yield* Effect.failCause(acquired.cause);
      }
      const result = yield* Effect.exit(
        restore(request).pipe(
          Effect.timeoutFail({
            duration: policy.requestMs,
            onTimeout: () =>
              slotError(
                policy,
                "request",
                "Host lease request deadline exceeded",
              ),
          }),
          Effect.ensuring(Effect.sleep(policy.gapMs)),
        ),
      );
      const released = yield* call("release", () => store.release(token));
      if (!released)
        return yield* Effect.fail(
          slotError(policy, "release", "Host lease ownership lost"),
        );
      return yield* result;
    }),
  );
}

/** Redis leases apply on Vercel and in production; local runs bypass them. */
export const providerHostSlotsEnabled = () =>
  process.env.VERCEL === "1" || process.env.NODE_ENV === "production";

export function providerHostSlot<A, E, R>(
  policy: ProviderHostPolicy,
  request: Effect.Effect<A, E, R>,
) {
  if (!providerHostSlotsEnabled()) return request;
  return Effect.try({
    try: () => {
      const url = process.env.UPSTASH_REDIS_REST_URL;
      const token = process.env.UPSTASH_REDIS_REST_TOKEN;
      if (!url || !token) throw new Error("Missing Upstash Redis URL or token");
      return redisProviderHostStore(
        policy,
        new Redis({
          url,
          token,
          retry: false,
          signal: () => AbortSignal.timeout(5_000),
        }),
      );
    },
    catch: (cause) => slotError(policy, "configuration", cause),
  }).pipe(
    Effect.flatMap((store) => withProviderHostSlot(policy, store, request)),
  );
}
