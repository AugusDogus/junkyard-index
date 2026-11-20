import { Redis } from "@upstash/redis";
import { Clock, Effect, FiberRef, Option } from "effect";
import {
  ProviderChunkClock,
  type ProviderTurnDeferred,
} from "./provider-chunk-clock";

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

/** How long a lease holder may wait and then hold the lease. */
interface LeaseTerms<W, T> {
  /** Held after the request, inside the lease. */
  gapMs: number;
  waitMs: number;
  onWaitTimeout: Effect.Effect<W>;
  /** Request time and timeout failure for a lease acquired at clock `now`. */
  hold: (now: number) => { ms: number; onTimeout: Effect.Effect<T> };
}

function withHostLease<A, E, R, W, T>(
  policy: ProviderHostPolicy,
  store: ProviderHostStore,
  request: Effect.Effect<A, E, R>,
  terms: LeaseTerms<W, T>,
): Effect.Effect<A, E | Error | W | T, R> {
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
  // The lease outlives the request by the policy's usual margin.
  const leaseMargin = policy.leaseMs - policy.requestMs;
  return Effect.uninterruptibleMask((restore) =>
    Effect.gen(function* () {
      const token = crypto.randomUUID();
      const acquired = yield* Effect.exit(
        restore(
          Effect.gen(function* () {
            const waitUntil = (yield* Clock.currentTimeMillis) + terms.waitMs;
            while (true) {
              const leaseMs =
                terms.hold(yield* Clock.currentTimeMillis).ms + leaseMargin;
              if (
                yield* call("reservation", () => store.reserve(token, leaseMs))
              )
                return;
              // The wait ends between polls, never during a reservation that
              // Redis may still grant, which would leave the lease held.
              if ((yield* Clock.currentTimeMillis) + policy.pollMs > waitUntil)
                return yield* Effect.flatMap(terms.onWaitTimeout, Effect.fail);
              yield* Effect.sleep(policy.pollMs);
            }
          }).pipe(
            // Waiting for a turn is not the chunk's provider work.
            ProviderChunkClock.queued,
          ),
        ),
      );
      if (acquired._tag === "Failure") {
        yield* call("queue cancellation", () => store.cancel(token));
        return yield* Effect.failCause(acquired.cause);
      }
      const hold = terms.hold(yield* Clock.currentTimeMillis);
      const result = yield* Effect.exit(
        restore(request).pipe(
          Effect.timeoutFail({
            duration: Math.max(0, hold.ms),
            onTimeout: () => null,
          }),
          Effect.catchIf(
            (error): error is null => error === null,
            () => Effect.flatMap(hold.onTimeout, Effect.fail),
          ),
          Effect.ensuring(Effect.sleep(terms.gapMs)),
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

export function withProviderHostSlot<A, E, R>(
  policy: ProviderHostPolicy,
  store: ProviderHostStore,
  request: Effect.Effect<A, E, R>,
): Effect.Effect<A, E | Error, R> {
  return withHostLease(policy, store, request, {
    gapMs: policy.gapMs,
    waitMs: policy.waitMs,
    onWaitTimeout: Effect.succeed(
      slotError(policy, "reservation", "Host remained busy"),
    ),
    hold: () => ({
      ms: policy.requestMs,
      onTimeout: Effect.succeed(
        slotError(policy, "request", "Host lease request deadline exceeded"),
      ),
    }),
  });
}

/** A turn whose lease the current fiber holds. */
interface HeldTurn {
  /** Clock time at which the turn's latest slotted request ended. */
  lastRequestEndedAt: number | null;
}

/** Turns the current fiber holds, by policy key. */
const HeldHostTurns = FiberRef.unsafeMake<ReadonlyMap<string, HeldTurn>>(
  new Map(),
);

/** Expected time for one request in a turn, before the policy gap. Live URG
 * and VinPlus pages typically answer in one to two seconds. */
const TURN_REQUEST_ESTIMATE_MS = 5_000;

/**
 * Holds one lease for `unit`, which makes `requests` sequential requests to
 * the policy's backend. The turn always holds the policy gap after `unit`
 * inside the lease, whether or not its last request took a host slot, so no
 * turn releases the backend straight after a request. Host slots inside the
 * turn keep the gap between its requests. Use it for a request site, or for
 * requests that only together let a chunk advance, so a chunk needs one queue
 * turn to make progress.
 *
 * Inside a chunk deadline the turn must end by the chunk's turn horizon: it
 * waits only while the estimated work still fits, and work still running at
 * the horizon is interrupted. Either way it fails with `ProviderTurnDeferred`
 * and nothing from the turn is returned. Outside a chunk each request may take
 * the policy's usual request time. A turn inside a held lease runs directly.
 */
export function withProviderHostTurn<A, E, R>(
  policy: ProviderHostPolicy,
  store: ProviderHostStore,
  requests: number,
  unit: Effect.Effect<A, E, R>,
): Effect.Effect<A, E | Error | ProviderTurnDeferred, R> {
  const bound = requests * policy.requestMs;
  // Fresh state for every run of the turn, including retries.
  const held = Effect.suspend(() => {
    const turn: HeldTurn = { lastRequestEndedAt: null };
    return Effect.locallyWith(unit, HeldHostTurns, (turns) =>
      new Map(turns).set(policy.key, turn),
    );
  });
  const requestDeadline = Effect.succeed(
    slotError(policy, "request", "Host lease request deadline exceeded"),
  );
  return Effect.flatMap(ProviderChunkClock.turnHorizon, (horizon) =>
    Option.match(horizon, {
      onNone: () =>
        withHostLease(policy, store, held, {
          gapMs: policy.gapMs,
          waitMs: policy.waitMs,
          onWaitTimeout: Effect.succeed(
            slotError(policy, "reservation", "Host remained busy"),
          ),
          hold: () => ({ ms: bound, onTimeout: requestDeadline }),
        }),
      onSome: (horizon) =>
        Effect.gen(function* () {
          const work = requests * (TURN_REQUEST_ESTIMATE_MS + policy.gapMs);
          const waitMs = horizon - work - (yield* Clock.currentTimeMillis);
          if (waitMs <= 0)
            return yield* Effect.flip(
              ProviderChunkClock.deferred(policy.label, "wait"),
            );
          return yield* withHostLease(policy, store, held, {
            gapMs: policy.gapMs,
            waitMs,
            onWaitTimeout: ProviderChunkClock.deferred(policy.label, "wait"),
            hold: (now) =>
              horizon - now < bound
                ? {
                    ms: horizon - now,
                    onTimeout: ProviderChunkClock.deferred(
                      policy.label,
                      "work",
                    ),
                  }
                : { ms: bound, onTimeout: requestDeadline },
          });
        }),
    }),
  );
}

function onHostStore<A, E, R>(
  policy: ProviderHostPolicy,
  use: (store: ProviderHostStore) => Effect.Effect<A, E | Error, R>,
  bypass: Effect.Effect<A, E, R>,
): Effect.Effect<A, E | Error, R> {
  return process.env.VERCEL !== "1" && process.env.NODE_ENV !== "production"
    ? bypass
    : withRedisProviderHostStore(policy, use);
}

export function providerHostSlot<A, E, R>(
  policy: ProviderHostPolicy,
  request: Effect.Effect<A, E, R>,
): Effect.Effect<A, E | Error, R> {
  return Effect.flatMap(FiberRef.get(HeldHostTurns), (turns) => {
    const turn = turns.get(policy.key);
    return turn
      ? // The enclosing turn owns the lease and holds the gap after its last
        // request; keep the gap after the turn's previous request.
        Effect.gen(function* () {
          if (turn.lastRequestEndedAt !== null)
            yield* Effect.sleep(
              Math.max(
                0,
                turn.lastRequestEndedAt +
                  policy.gapMs -
                  (yield* Clock.currentTimeMillis),
              ),
            );
          return yield* request.pipe(
            Effect.ensuring(
              Effect.flatMap(Clock.currentTimeMillis, (now) =>
                Effect.sync(() => {
                  turn.lastRequestEndedAt = now;
                }),
              ),
            ),
          );
        })
      : onHostStore(
          policy,
          (store) => withProviderHostSlot(policy, store, request),
          request,
        );
  });
}

export function providerHostTurn<A, E, R>(
  policy: ProviderHostPolicy,
  requests: number,
  unit: Effect.Effect<A, E, R>,
): Effect.Effect<A, E | Error | ProviderTurnDeferred, R> {
  return Effect.flatMap(FiberRef.get(HeldHostTurns), (turns) =>
    turns.has(policy.key)
      ? unit
      : onHostStore(
          policy,
          (store) => withProviderHostTurn(policy, store, requests, unit),
          unit,
        ),
  );
}

function withRedisProviderHostStore<A, E, R>(
  policy: ProviderHostPolicy,
  use: (store: ProviderHostStore) => Effect.Effect<A, E, R>,
) {
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
  }).pipe(Effect.flatMap(use));
}
