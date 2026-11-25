import { Redis } from "@upstash/redis";
import { Clock, Effect, FiberRef, Option, type Scope } from "effect";
import {
  ProviderChunkClock,
  type ProviderTurnDeferred,
} from "./provider-chunk-clock";

/** A reservation attempt: the lease, or where the waiter stands in line. */
export type HostReservation =
  | { readonly _tag: "Granted" }
  | {
      readonly _tag: "Queued";
      /** Waiters ahead of this one in its lane. */
      readonly laneAhead: number;
      /** Ready lanes that take a group place before this one, counting the
       * release it waits for when every place is taken. Waiters within the
       * group's first activeLanes poll every pollMs. */
      readonly readyAhead: number;
    };

/** Longest sleep between polls. Each poll renews the waiter's 30 s queue
 * deadline, and a store call may take 5 s, so this keeps a live waiter in
 * line. */
const MAX_POLL_MS = 10_000;

const GRANTED: HostReservation = { _tag: "Granted" };
const isCount = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

export const HostReservation = {
  granted: GRANTED,
  queued: (laneAhead: number, readyAhead: number): HostReservation => ({
    _tag: "Queued",
    laneAhead,
    readyAhead,
  }),

  /** Reads a `RESERVE_HOST_SLOT` reply: `{granted, laneAhead, readyAhead}`. */
  parse(reply: unknown): HostReservation {
    if (Array.isArray(reply) && reply.length === 3) {
      const [granted, laneAhead, readyAhead]: unknown[] = reply;
      if (granted === 1) return GRANTED;
      if (granted === 0 && isCount(laneAhead) && isCount(readyAhead))
        return HostReservation.queued(laneAhead, readyAhead);
    }
    throw new Error(
      `Host reservation script replied ${JSON.stringify(reply)}, expected [granted, laneAhead, readyAhead]. The reservation state is unknown, so the waiter gives up its place.`,
    );
  },

  /**
   * How long a queued waiter sleeps before it polls again. Every turn ahead of
   * it in its lane holds the lease for at least the policy gap (or one poll
   * for a lease without a gap), and the group's places share the ready lanes'
   * turns. A waiter ahead that gives up its place early only delays this one
   * by the difference, never past `MAX_POLL_MS`.
   */
  pollDelayMs(
    policy: Pick<ProviderHostPolicy, "pollMs" | "group"> & { gapMs?: number },
    reservation: Extract<HostReservation, { _tag: "Queued" }>,
  ): number {
    const turnMs = Math.max(policy.pollMs, policy.gapMs ?? 0);
    // The first activeLanes releases have no lower bound on when they come,
    // so a ready lane among them polls every pollMs; only releases beyond
    // those wait at least a turn per activeLanes.
    const lanes = policy.group?.activeLanes ?? 1;
    const ahead =
      reservation.laneAhead +
      Math.max(0, reservation.readyAhead - lanes) / lanes;
    return Math.min(MAX_POLL_MS, policy.pollMs + ahead * turnMs);
  },
} as const;

export interface ProviderHostStore {
  reserve(token: string, leaseMs: number): Promise<HostReservation>;
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
/** What a lease held for a whole scope needs from a policy: no per-request
 * time or gap, since the holder paces its own requests. */
export type ProviderLeasePolicy = Pick<
  ProviderHostPolicy,
  "key" | "label" | "leaseMs" | "waitMs" | "pollMs" | "group"
>;

const slotError = (
  policy: ProviderLeasePolicy,
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
 *
 * Replies `{granted, laneAhead, readyAhead}` (see `HostReservation`), so a
 * waiter far back can poll less often. Upstash bills every command a script
 * runs, so a waiter's repoll runs only what keeps its place: queue TTLs are
 * renewed only once they fall below the 30 s waiter deadline, and a request
 * nobody is queued for takes the lease without joining a queue. Older
 * deployments run the previous script on the same keys during a rollout;
 * both keep the same FIFO order, group cap and expiry.
 */
export const RESERVE_HOST_SLOT = `
-- The last argument is '1' on a token's first attempt, which alone may find
-- every queue empty and skip them.
local first = ARGV[#ARGV] == '1'
local ms
local function clock()
  if not ms then
    local now = redis.call('TIME')
    ms = now[1] * 1000 + math.floor(now[2] / 1000)
  end
  return ms
end
-- Registers ARGV[1] at the back of a FIFO queue once, renews its deadline,
-- and returns how many waiters stand ahead of it.
local function place(queue, deadlines, sequence)
  local expired = redis.call('ZRANGEBYSCORE', deadlines, '-inf', clock())
  for _, token in ipairs(expired) do
    redis.call('ZREM', queue, token)
    redis.call('ZREM', deadlines, token)
  end
  local rank = redis.call('ZRANK', queue, ARGV[1])
  if not rank then
    redis.call('ZADD', queue, redis.call('INCR', sequence), ARGV[1])
    rank = redis.call('ZRANK', queue, ARGV[1])
  end
  redis.call('ZADD', deadlines, clock() + 30000, ARGV[1])
  -- The three keys are always renewed together, so one TTL stands for all.
  if redis.call('PTTL', deadlines) < 30000 then
    redis.call('PEXPIRE', queue, 60000)
    redis.call('PEXPIRE', deadlines, 60000)
    redis.call('PEXPIRE', sequence, 60000)
  end
  return rank
end
local function leave(queue, deadlines)
  redis.call('ZREM', queue, ARGV[1])
  redis.call('ZREM', deadlines, ARGV[1])
end
if #KEYS == 4 then
  -- A missing queue key means nobody waits for the lane.
  if first and redis.call('EXISTS', KEYS[2]) == 0 then
    if redis.call('SET', KEYS[1], ARGV[1], 'NX', 'PX', ARGV[2]) then return {1, 0, 0} end
    place(KEYS[2], KEYS[3], KEYS[4])
    return {0, 0, 0}
  end
  local ahead = place(KEYS[2], KEYS[3], KEYS[4])
  if ahead > 0 then return {0, ahead, 0} end
  if not redis.call('SET', KEYS[1], ARGV[1], 'NX', 'PX', ARGV[2]) then return {0, 0, 0} end
  leave(KEYS[2], KEYS[3])
  return {1, 0, 0}
end
local ttl = tonumber(ARGV[2])
local active
local function places()
  if not active then
    redis.call('ZREMRANGEBYSCORE', KEYS[8], '-inf', clock())
    active = redis.call('ZCARD', KEYS[8])
  end
  return math.max(0, tonumber(ARGV[3]) - active)
end
local function take()
  redis.call('SET', KEYS[1], ARGV[1], 'PX', ttl)
  redis.call('ZADD', KEYS[8], clock() + ttl, ARGV[1])
  if redis.call('PTTL', KEYS[8]) < ttl then redis.call('PEXPIRE', KEYS[8], ttl) end
  return {1, 0, 0}
end
-- Nobody waits for the lane or for a place, and the lane is free.
local idle = first and redis.call('EXISTS', KEYS[2], KEYS[1], KEYS[5]) == 0
if idle and places() > 0 then return take() end
local ahead = place(KEYS[2], KEYS[3], KEYS[4])
if ahead > 0 then return {0, ahead, 0} end
if not idle and redis.call('EXISTS', KEYS[1]) == 1 then return {0, 0, 0} end
local free = places()
local rank = place(KEYS[5], KEYS[6], KEYS[7])
if rank >= free then return {0, 0, rank - free + 1} end
take()
leave(KEYS[5], KEYS[6])
leave(KEYS[2], KEYS[3])
return {1, 0, 0}
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
  policy: ProviderLeasePolicy,
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
  policy: ProviderLeasePolicy,
  redis: Pick<Redis, "eval">,
  keyspace: ProviderHostKeyspace,
): ProviderHostStore {
  const { lease, lane, ready, readySequence, active } = providerHostKeys(
    policy,
    keyspace,
  );
  // Tokens this store has queued, whose later attempts are repolls.
  const queued = new Set<string>();
  return {
    reserve: async (owner, ttl) => {
      const first = queued.has(owner) ? 0 : 1;
      queued.add(owner);
      const reservation = HostReservation.parse(
        await redis.eval(
          RESERVE_HOST_SLOT,
          policy.group ? [...lane, ...ready, readySequence, active] : lane,
          policy.group
            ? [owner, ttl, policy.group.activeLanes, first]
            : [owner, ttl, first],
        ),
      );
      if (reservation._tag === "Granted") queued.delete(owner);
      return reservation;
    },
    release: async (owner) =>
      (await redis.eval(
        RELEASE_HOST_SLOT,
        policy.group ? [lease, active] : [lease],
        [owner],
      )) === 1,
    cancel: async (owner) => {
      queued.delete(owner);
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

/** One store call, bounded so a stalled Redis fails instead of hanging. */
const storeCall = <A>(
  policy: ProviderLeasePolicy,
  operation: string,
  run: () => Promise<A>,
) =>
  Effect.tryPromise({
    try: run,
    catch: (cause) => slotError(policy, operation, cause),
  }).pipe(
    Effect.timeoutFail({
      duration: "5 seconds",
      onTimeout: () => slotError(policy, operation, "Redis deadline exceeded"),
    }),
  );

/**
 * Sleeps until a queued waiter's next poll (`HostReservation.pollDelayMs`),
 * or returns false once its wait has ended. The wait ends between polls,
 * never during a reservation that Redis may still grant, which would leave
 * the lease held.
 */
const awaitNextPoll = (
  policy: Parameters<typeof HostReservation.pollDelayMs>[0],
  reservation: Extract<HostReservation, { _tag: "Queued" }>,
  waitUntil: number,
) =>
  Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis;
    if (now + policy.pollMs > waitUntil) return false;
    yield* Effect.sleep(
      Math.min(
        HostReservation.pollDelayMs(policy, reservation),
        waitUntil - now,
      ),
    );
    return true;
  });

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
  const call = <B>(operation: string, run: () => Promise<B>) =>
    storeCall(policy, operation, run);
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
              const reservation = yield* call("reservation", () =>
                store.reserve(token, leaseMs),
              );
              if (reservation._tag === "Granted") return;
              if (!(yield* awaitNextPoll(policy, reservation, waitUntil)))
                return yield* Effect.flatMap(terms.onWaitTimeout, Effect.fail);
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

/**
 * Holds the policy's lease for the enclosing scope, which releases it when it
 * closes, on success, failure or interruption. A holder that dies without
 * releasing loses the lease after `leaseMs`. Waiting is FIFO, polls every
 * `pollMs` and counts as queue time. It lasts at most `waitMs` and, inside a
 * chunk deadline, only while the chunk's remaining work allowance still fits
 * before its turn horizon (`ProviderChunkClock.leaseHorizon`). After that it
 * fails with `ProviderTurnDeferred` and gives up its place.
 *
 * Lock order: a scoped lease is taken before any shared host turn, never
 * inside one. A turn holder therefore never waits for a lease holder, so a
 * lease holder may wait for turns without deadlock. Waiting for a lease inside
 * a held turn fails.
 */
export function withProviderHostLease(
  policy: ProviderLeasePolicy,
  store: ProviderHostStore,
): Effect.Effect<void, Error | ProviderTurnDeferred, Scope.Scope> {
  return Effect.uninterruptibleMask((restore) =>
    Effect.gen(function* () {
      const turns = yield* FiberRef.get(HeldHostTurns);
      if (turns.size > 0)
        return yield* Effect.fail(
          new Error(
            `${policy.label} lease was requested inside a shared host turn (${[...turns.keys()].join(", ")}), which could deadlock with a lease holder waiting for that turn. Nothing was requested and prior inventory is preserved. Take the lease before the turn.`,
          ),
        );
      const token = crypto.randomUUID();
      const now = yield* Clock.currentTimeMillis;
      const waitUntil = Option.match(yield* ProviderChunkClock.leaseHorizon, {
        onNone: () => now + policy.waitMs,
        onSome: (latest) => Math.min(now + policy.waitMs, latest),
      });
      const acquired = yield* Effect.exit(
        restore(
          Effect.gen(function* () {
            while (true) {
              const reservation = yield* storeCall(policy, "reservation", () =>
                store.reserve(token, policy.leaseMs),
              );
              if (reservation._tag === "Granted") return;
              // As in a turn, the wait ends between polls.
              if (!(yield* awaitNextPoll(policy, reservation, waitUntil)))
                return yield* Effect.flip(
                  ProviderChunkClock.deferred(policy.label, "wait"),
                );
            }
          }).pipe(ProviderChunkClock.queued),
        ),
      );
      if (acquired._tag === "Failure") {
        yield* storeCall(policy, "queue cancellation", () =>
          store.cancel(token),
        );
        return yield* Effect.failCause(acquired.cause);
      }
      yield* Effect.addFinalizer(() =>
        storeCall(policy, "release", () => store.release(token)).pipe(
          Effect.flatMap((released) =>
            released
              ? Effect.void
              : Effect.logWarning(
                  `${policy.label} lease had already expired when its holder released it, so another holder may have overlapped it. Leases last ${policy.leaseMs} ms; look for a holder that ran longer.`,
                ),
          ),
          Effect.catchAll((error) =>
            Effect.logWarning(
              `${error.message} The lease expires ${policy.leaseMs} ms after it was granted.`,
            ),
          ),
        ),
      );
    }),
  );
}

function onHostStore<A, E, R>(
  policy: ProviderLeasePolicy,
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

/** `withProviderHostLease` on the deployment's Redis store, or no lease for
 * a local process, like every shared host gate. */
export function providerHostLease(
  policy: ProviderLeasePolicy,
): Effect.Effect<void, Error | ProviderTurnDeferred, Scope.Scope> {
  return Effect.suspend(() =>
    onHostStore(
      policy,
      (store) => withProviderHostLease(policy, store),
      Effect.void,
    ),
  );
}

function withRedisProviderHostStore<A, E, R>(
  policy: ProviderLeasePolicy,
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
