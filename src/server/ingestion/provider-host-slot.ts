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
/** Host lanes that each pace one origin server but share a cap on how many of
 * them may hold a lease at once, as a hedge for a backend they all call. */
export interface ProviderHostGroup {
  key: string;
  /** Lanes that may hold a lease at the same time. */
  activeLanes: number;
}
export interface ProviderHostPolicy {
  key: string;
  label: string;
  leaseMs: number;
  requestMs: number;
  waitMs: number;
  pollMs: number;
  gapMs: number;
  group?: ProviderHostGroup;
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

/**
 * Atomic FIFO registration and acquisition of a lane lease (KEYS 1 to 4).
 * Polls renew the waiter's deadline without changing its order. Dead workers
 * expire instead of blocking the queue.
 *
 * A grouped lane also passes its group's ready queue (KEYS 5 to 7) and active
 * lanes (KEYS 8), with the group's lane cap as ARGV[3]. A waiter at the front
 * of its free lane joins the ready queue, and ready waiters take the group's
 * free places in the order they became ready. Only lane holders wait there, so
 * a busy lane never holds back another lane's waiter. Active entries expire
 * with their lease.
 *
 * All keys share one Redis hash tag for cluster-safe scripts.
 */
export const RESERVE_HOST_SLOT = `
local now = redis.call('TIME')
local ms = now[1] * 1000 + math.floor(now[2] / 1000)
local function front(queue, deadlines, sequence)
  local expired = redis.call('ZRANGEBYSCORE', deadlines, '-inf', ms)
  for _, token in ipairs(expired) do
    redis.call('ZREM', queue, token)
    redis.call('ZREM', deadlines, token)
  end
  if not redis.call('ZSCORE', queue, ARGV[1]) then
    redis.call('ZADD', queue, redis.call('INCR', sequence), ARGV[1])
  end
  redis.call('ZADD', deadlines, ms + 30000, ARGV[1])
  redis.call('PEXPIRE', queue, 60000)
  redis.call('PEXPIRE', deadlines, 60000)
  redis.call('PEXPIRE', sequence, 60000)
  return redis.call('ZRANGE', queue, 0, 0)[1] == ARGV[1]
end
if not front(KEYS[2], KEYS[3], KEYS[4]) then return 0 end
if #KEYS == 4 then
  if not redis.call('SET', KEYS[1], ARGV[1], 'NX', 'PX', ARGV[2]) then return 0 end
else
  if redis.call('EXISTS', KEYS[1]) == 1 then return 0 end
  redis.call('ZREMRANGEBYSCORE', KEYS[8], '-inf', ms)
  front(KEYS[5], KEYS[6], KEYS[7])
  local places = tonumber(ARGV[3]) - redis.call('ZCARD', KEYS[8])
  if places <= 0 or redis.call('ZRANK', KEYS[5], ARGV[1]) >= places then return 0 end
  local ttl = tonumber(ARGV[2])
  redis.call('SET', KEYS[1], ARGV[1], 'PX', ttl)
  redis.call('ZADD', KEYS[8], ms + ttl, ARGV[1])
  if redis.call('PTTL', KEYS[8]) < ttl then redis.call('PEXPIRE', KEYS[8], ttl) end
  redis.call('ZREM', KEYS[5], ARGV[1])
  redis.call('ZREM', KEYS[6], ARGV[1])
end
redis.call('ZREM', KEYS[2], ARGV[1])
redis.call('ZREM', KEYS[3], ARGV[1])
return 1
`;

/** Releases KEYS[1] if ARGV[1] still owns it, and its group place (KEYS[2],
 * if any) either way. */
export const RELEASE_HOST_SLOT = `
if KEYS[2] then redis.call('ZREM', KEYS[2], ARGV[1]) end
if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end
`;

/**
 * Which deployment's host gates a process joins, from `VERCEL_ENV`. "local"
 * is any process outside a Vercel deployment.
 */
export type ProviderHostKeyspace =
  | "production"
  | "preview"
  | "development"
  | "local";

export const ProviderHostKeyspace = {
  parse(vercelEnv: string | undefined): ProviderHostKeyspace {
    switch (vercelEnv) {
      case "production":
      case "preview":
      case "development":
        return vercelEnv;
      default:
        return "local";
    }
  },
} as const;

/**
 * Redis keys for a policy's lane. Production keeps its unprefixed keys:
 * renaming them would let runs on an older deployment and a newer one queue
 * apart and reach an origin server at once. Other keyspaces put their name
 * inside the hash tag, so they never hold or join production's queues and
 * every key still shares one cluster slot.
 */
export function providerHostKeys(
  policy: ProviderHostPolicy,
  keyspace: ProviderHostKeyspace,
) {
  const base =
    keyspace === "production" ? "ingestion" : `${keyspace}:ingestion`;
  // Keep the existing HTP lease key during rolling deployments. Hash-tag
  // queue keys with its complete name so all scripts use the same cluster
  // slot. Every lane of a group shares the group's hash tag instead, so one
  // script sees the lane and the group's places.
  const tag = policy.group
    ? `{${base}:host-group:${policy.group.key}:v1}`
    : `{${base}:host:${policy.key}:v1}`;
  const lease = policy.group
    ? `${tag}:lane:${policy.key}`
    : `${base}:host:${policy.key}:v1`;
  const prefix = policy.group ? lease : tag;
  return {
    lease,
    lane: [
      lease,
      `${prefix}:queue`,
      `${prefix}:deadlines`,
      `${prefix}:sequence`,
    ],
    ready: [`${tag}:ready`, `${tag}:ready-deadlines`],
    readySequence: `${tag}:ready-sequence`,
    active: `${tag}:active`,
  };
}

export function redisProviderHostStore(
  policy: ProviderHostPolicy,
  redis: Pick<Redis, "eval">,
  keyspace: ProviderHostKeyspace,
): ProviderHostStore {
  const { lease, lane, ready, readySequence, active } = providerHostKeys(
    policy,
    keyspace,
  );
  return {
    reserve: async (owner, ttl) =>
      (await redis.eval(
        RESERVE_HOST_SLOT,
        policy.group ? [...lane, ...ready, readySequence, active] : lane,
        policy.group ? [owner, ttl, policy.group.activeLanes] : [owner, ttl],
      )) === 1,
    release: async (owner) =>
      (await redis.eval(
        RELEASE_HOST_SLOT,
        policy.group ? [lease, active] : [lease],
        [owner],
      )) === 1,
    cancel: async (owner) => {
      // A timed-out Redis response may have acquired the lease. Keep that
      // lease until expiry; cancellation removes only its queued registration.
      await redis.eval(
        "for _, key in ipairs(KEYS) do redis.call('ZREM', key, ARGV[1]) end return 1",
        policy.group ? [...lane.slice(1, 3), ...ready] : lane.slice(1, 3),
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
 * waits only while the estimated work, plus `afterMs` of work outside any turn
 * that must follow it in the chunk, still fits. Work still running at the
 * horizon is interrupted. Either way it fails with `ProviderTurnDeferred`
 * and nothing from the turn is returned. Outside a chunk each request may take
 * the policy's usual request time. A turn inside a held lease runs directly.
 */
export function withProviderHostTurn<A, E, R>(
  policy: ProviderHostPolicy,
  store: ProviderHostStore,
  requests: number,
  unit: Effect.Effect<A, E, R>,
  afterMs = 0,
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
          const work =
            requests * (TURN_REQUEST_ESTIMATE_MS + policy.gapMs) + afterMs;
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
  afterMs = 0,
): Effect.Effect<A, E | Error | ProviderTurnDeferred, R> {
  return Effect.flatMap(FiberRef.get(HeldHostTurns), (turns) =>
    turns.has(policy.key)
      ? unit
      : onHostStore(
          policy,
          (store) =>
            withProviderHostTurn(policy, store, requests, unit, afterMs),
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
        ProviderHostKeyspace.parse(process.env.VERCEL_ENV),
      );
    },
    catch: (cause) => slotError(policy, "configuration", cause),
  }).pipe(Effect.flatMap(use));
}
