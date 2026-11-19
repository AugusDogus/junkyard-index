import type { CreateSessionParams } from "@hyperbrowser/sdk/types";
import { Cause, Chunk, Data, Effect, Runtime, Schedule } from "effect";
import {
  ProviderHostBusyError,
  providerHostSlot,
  providerHostSlotsEnabled,
  type ProviderHostPolicy,
} from "./provider-host-slot";

/** Session creation, CDP connection and the origin navigation together. */
export const HYPERBROWSER_SETUP_MS = 2 * 60_000;
/** The Hyperbrowser plan allows one active session. Every browser-backed
 * source holds this FIFO lease for its whole session, so chunks take turns
 * instead of failing at session creation. The hold cap covers bounded setup
 * plus the longest browser chunk (URG IIS: eight minutes); with the wait it
 * stays inside Vercel's 800-second function limit (90 s + 630 s). */
export const HYPERBROWSER_SESSION_POLICY: ProviderHostPolicy = {
  key: "hyperbrowser-session",
  label: "Hyperbrowser session",
  leaseMs: 690_000,
  requestMs: 630_000,
  waitMs: 90_000,
  pollMs: 1_000,
  gapMs: 2_000,
};
/** Server-side lifetime cap, so a session orphaned by a killed function ends
 * shortly after its lease expires instead of blocking the plan. */
export const HYPERBROWSER_SESSION_TIMEOUT_MINUTES = 12;
/** Durable wait before a deferred chunk queues for the session again. */
export const HYPERBROWSER_BUSY_RETRY_MS = 2 * 60_000;
const SESSION_LIMIT_POLL = "10 seconds";
const SESSION_LIMIT_POLLS = 6;
/** Local runs bypass Redis; this keeps their browser sources taking turns. */
const localSessions = Effect.runSync(Effect.makeSemaphore(1));

export class HyperbrowserCapacityError extends Data.TaggedError(
  "HyperbrowserCapacityError",
)<{ reason: string; retryAfterMs: number }> {
  override get message() {
    return `No Hyperbrowser session is free: ${this.reason}. The chunk sent no provider requests, and its checkpoint and published inventory are preserved. It will queue again in ${Math.round(this.retryAfterMs / 1000)} seconds.`;
  }
}

class SessionLimitReached extends Data.TaggedError("SessionLimitReached")<{
  cause: Error;
}> {}

/** The SDK replaces its CommonJS exports, so HyperbrowserError is not
 * importable at runtime; match its name and the plan-limit message instead. */
const isSessionLimit = (cause: unknown): cause is Error =>
  cause instanceof Error &&
  cause.name === "HyperbrowserError" &&
  /maximum number of active sessions/i.test(cause.message);

const toError = (cause: unknown) =>
  cause instanceof Error ? cause : new Error(String(cause));

/** Finds a capacity failure through Error causes, Effect fiber failures and
 * the wrappers connectors add, so the workflow can defer instead of failing. */
export function findHyperbrowserCapacityError(
  error: unknown,
): HyperbrowserCapacityError | null {
  const pending = [error];
  const seen = new Set<unknown>();
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === null || typeof current !== "object" || seen.has(current))
      continue;
    seen.add(current);
    if (current instanceof HyperbrowserCapacityError) return current;
    if (Runtime.isFiberFailure(current)) {
      const cause = current[Runtime.FiberFailureCauseId];
      pending.push(
        ...Chunk.toReadonlyArray(Cause.failures(cause)),
        ...Chunk.toReadonlyArray(Cause.defects(cause)),
      );
    }
    if (current instanceof AggregateError) pending.push(...current.errors);
    if ("cause" in current) pending.push(current.cause);
    // Effect's UnknownException keeps the rejected value in `error`.
    if (Cause.isUnknownException(current)) pending.push(current.error);
  }
  return null;
}

/** Runs `use` while holding the plan's only browser session lease. A lease
 * still busy after the bounded wait becomes a HyperbrowserCapacityError.
 * `slot` is the Redis lease in production; tests pass a fake store. */
export function withHyperbrowserSessionLease<A, E, R>(
  use: Effect.Effect<A, E, R>,
  slot: <B, F, Q>(
    effect: Effect.Effect<B, F, Q>,
  ) => Effect.Effect<B, F | Error, Q> = (effect) =>
    providerHostSlotsEnabled()
      ? providerHostSlot(HYPERBROWSER_SESSION_POLICY, effect)
      : localSessions.withPermits(1)(effect),
): Effect.Effect<A, E | Error | HyperbrowserCapacityError, R> {
  return slot(use).pipe(
    Effect.catchIf(
      (error): error is ProviderHostBusyError =>
        error instanceof ProviderHostBusyError &&
        error.policyKey === HYPERBROWSER_SESSION_POLICY.key,
      () =>
        Effect.fail(
          new HyperbrowserCapacityError({
            reason:
              "another ingestion source held the plan's only browser session for the whole wait",
            retryAfterMs: HYPERBROWSER_BUSY_RETRY_MS,
          }),
        ),
    ),
  );
}

/** Creates a session with a bounded server-side lifetime. A session left by a
 * killed worker (or a local run on the same key) can still occupy the plan, so
 * the limit is polled briefly before deferring. */
export function createHyperbrowserSession<Session>(
  sessions: { create(params?: CreateSessionParams): Promise<Session> },
  params: Omit<CreateSessionParams, "timeoutMinutes">,
): Effect.Effect<Session, Error | HyperbrowserCapacityError> {
  return Effect.tryPromise({
    try: () =>
      sessions.create({
        ...params,
        timeoutMinutes: HYPERBROWSER_SESSION_TIMEOUT_MINUTES,
      }),
    catch: (cause) =>
      isSessionLimit(cause)
        ? new SessionLimitReached({ cause })
        : toError(cause),
  }).pipe(
    Effect.retry({
      schedule: Schedule.spaced(SESSION_LIMIT_POLL).pipe(
        Schedule.intersect(Schedule.recurs(SESSION_LIMIT_POLLS)),
      ),
      while: (error) => error instanceof SessionLimitReached,
    }),
    Effect.catchIf(
      (error): error is SessionLimitReached =>
        error instanceof SessionLimitReached,
      (error) =>
        Effect.fail(
          new HyperbrowserCapacityError({
            reason: `Hyperbrowser still reported its active-session limit after a minute (${error.cause.message})`,
            retryAfterMs: HYPERBROWSER_BUSY_RETRY_MS,
          }),
        ),
    ),
  );
}
