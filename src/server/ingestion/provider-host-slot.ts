import { Clock, Effect, FiberRef, Option, type Scope } from "effect";
import {
  ProviderChunkClock,
  type ProviderTurnDeferred,
} from "./provider-chunk-clock";
import { processProviderHostStore } from "./process-host-store";

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

export const HostReservation = {
  granted: GRANTED,
  queued: (laneAhead: number, readyAhead: number): HostReservation => ({
    _tag: "Queued",
    laneAhead,
    readyAhead,
  }),

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

/** Where a policy's leases are kept (see `processProviderHostStore`). */
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
    `${policy.label} shared host slot ${operation} failed. Prior inventory and checkpoint remain preserved; the chunk retries from its last checkpoint.`,
    { cause },
  );

/** One store call, bounded so a stalled store fails instead of hanging. */
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
      onTimeout: () => slotError(policy, operation, "Store deadline exceeded"),
    }),
  );

/**
 * Sleeps until a queued waiter's next poll (`HostReservation.pollDelayMs`),
 * or returns false once its wait has ended. The wait ends between polls,
 * never during a reservation that the store may still grant, which would leave
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

/** Where a deployed process keeps a policy's leases: in the process, since
 * the daily pass schedules runs that share a host (`HostClaims`). */
let deployedHostStore: (policy: ProviderLeasePolicy) => ProviderHostStore =
  processProviderHostStore;

export const ProviderHostStores = {
  /**
   * Runs `run` with `store` keeping every policy's leases, as on a
   * deployment, and restores the deployed stores after. Tests use it to
   * simulate other sources holding a host.
   */
  async using<T>(
    store: (policy: ProviderLeasePolicy) => ProviderHostStore,
    run: () => Promise<T>,
  ): Promise<T> {
    const deployed = deployedHostStore;
    deployedHostStore = store;
    try {
      return await run();
    } finally {
      deployedHostStore = deployed;
    }
  },
} as const;

function onHostStore<A, E, R>(
  policy: ProviderLeasePolicy,
  use: (store: ProviderHostStore) => Effect.Effect<A, E | Error, R>,
  bypass: Effect.Effect<A, E, R>,
): Effect.Effect<A, E | Error, R> {
  return process.env.VERCEL !== "1" && process.env.NODE_ENV !== "production"
    ? bypass
    : Effect.suspend(() => use(deployedHostStore(policy)));
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

/** `withProviderHostLease` on the deployment's store, or no lease for a
 * local process, like every shared host gate. */
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
