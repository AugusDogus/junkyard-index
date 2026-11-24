import {
  Cause,
  Clock,
  Data,
  Duration,
  Effect,
  FiberRef,
  Option,
  Runtime,
} from "effect";

/**
 * Time accounting for one connector chunk.
 *
 * Shared provider host queues (`shared-provider-host.ts`) serialize every
 * request to a backend across all sources. Under the daily 07:00 contention a
 * request can wait minutes for its turn, so a deadline measured in wall time
 * fails chunks whose own provider work takes seconds. The chunk clock excludes
 * queue time from the work deadline, while a wall limit keeps the whole chunk
 * inside the Vercel function that runs it. Shared host turns
 * (`sharedProviderHostTurn`) end by the chunk's turn horizon: a turn that
 * cannot arrive and finish its work in time is deferred instead, so the chunk
 * returns its last validated checkpoint rather than failing.
 */
interface ChunkClock {
  readonly startedAt: number;
  /** Provider work the chunk may do, excluding queue time. */
  readonly workLimitMs: number;
  /** Completed time during which at least one request waited for a turn. */
  queuedMs: number;
  queuedSince: number;
  waiters: number;
}

const CurrentChunkClock = FiberRef.unsafeMake<ChunkClock | null>(null);

/** Workflow routes run with Vercel `maxDuration: "max"`, 800 s here. */
const FUNCTION_LIMIT = Duration.seconds(800);
/** Workflow 5.4.0 keeps starting steps inline until five minutes into an
 * invocation, so a chunk step can begin with only 500 s of function left. */
const LATEST_INLINE_STEP_START = Duration.minutes(5);
/** Cursor resolution before the chunk and the checkpoint write after it run in
 * the same step. */
const STEP_RESERVE = Duration.seconds(140);
/** Every chunk ends within this much wall time, so even a step started inline
 * at the latest point finishes its checkpoint well inside the function. */
export const PROVIDER_CHUNK_WALL_LIMIT = Duration.subtract(
  Duration.subtract(FUNCTION_LIMIT, LATEST_INLINE_STEP_START),
  STEP_RESERVE,
);
/** Shared host turns end this long before the wall limit, leaving time for the
 * policy gap, the lease release and the connector's own validation. */
const TURN_HORIZON_MARGIN = Duration.seconds(20);

export class ProviderChunkWallTimeout extends Data.TaggedError(
  "ProviderChunkWallTimeout",
)<{ elapsedMs: number; queuedMs: number }> {
  override get message() {
    return `Provider chunk reached its ${Duration.format(PROVIDER_CHUNK_WALL_LIMIT)} step allowance after ${Math.round(this.queuedMs / 1000)} s queued for shared host turns and ${Math.round((this.elapsedMs - this.queuedMs) / 1000)} s of provider work. No advanced checkpoint was accepted; prior inventory is preserved. A request ran past its shared host turn; the step retries from the last validated checkpoint.`;
  }
}

/**
 * A shared host turn could not arrive and finish its requests before the
 * chunk's turn horizon, or a request could not end within the chunk's work
 * allowance (`allowance`, see `ProviderChunkClock.workFits`). Nothing from the
 * deferred turn or request was accepted. A chunk that already advanced returns
 * its validated checkpoint instead (`ProviderChunkClock.unlessDeferred`); a
 * chunk that has not is deferred as a whole and the source retries the same
 * cursor.
 */
export class ProviderTurnDeferred extends Data.TaggedError(
  "ProviderTurnDeferred",
)<{
  host: string;
  stage: "wait" | "work" | "allowance";
  elapsedMs: number;
  queuedMs: number;
}> {
  override get message() {
    const time = `${Math.round(this.elapsedMs / 1000)} s elapsed, ${Math.round(this.queuedMs / 1000)} s queued`;
    if (this.stage === "allowance")
      return `${this.host} request was not sent because it could not end within this chunk's remaining work allowance (${time}). Nothing from it was accepted and the last validated checkpoint is preserved; the next chunk sends it.`;
    return `${this.host} shared host turn ${this.stage === "wait" ? "did not arrive" : "did not finish"} before this chunk's ${Duration.format(PROVIDER_CHUNK_WALL_LIMIT)} step allowance (${time}). The queue is too deep for another turn in this step, so nothing from that turn was accepted and the last validated checkpoint is preserved.`;
  }
}

/**
 * A provider refused new work because a concurrency, capacity or credit
 * limit is in use, such as a browser service's concurrent session cap or
 * spent monthly credit. Nothing from the
 * chunk was accepted, so the source retries the same cursor after its usual
 * deferral delay.
 */
export class ProviderCapacityDeferred extends Data.TaggedError(
  "ProviderCapacityDeferred",
)<{ provider: string; detail: string }> {
  override get message() {
    return `${this.provider} refused new work because a concurrency, capacity or credit limit is in use: ${this.detail} Nothing from this chunk was accepted and the last validated checkpoint is preserved; the source retries this chunk after its deferral delay.`;
  }
}

/** Why a chunk returned without work: no shared host turn in time, or no
 * provider capacity. Either way its cursor is retried later. */
export type ProviderChunkDeferral =
  | ProviderTurnDeferred
  | ProviderCapacityDeferred;

const isDeferral = (error: unknown): error is ProviderChunkDeferral =>
  error instanceof ProviderTurnDeferred ||
  error instanceof ProviderCapacityDeferred;

const queuedMs = (clock: ChunkClock, now: number) =>
  clock.queuedMs + (clock.waiters > 0 ? now - clock.queuedSince : 0);

export const ProviderChunkClock = {
  /**
   * Like `Effect.timeoutFail`, but `duration` bounds only the chunk's own work:
   * time spent waiting for a shared provider host turn does not count. The
   * whole chunk still fails with `ProviderChunkWallTimeout` once it reaches
   * `PROVIDER_CHUNK_WALL_LIMIT` of wall time, which shared host turns avoid by
   * ending at the chunk's turn horizon.
   */
  deadline:
    <E2>(options: { duration: Duration.DurationInput; onTimeout: () => E2 }) =>
    <A, E, R>(
      chunk: Effect.Effect<A, E, R>,
    ): Effect.Effect<A, E | E2 | ProviderChunkWallTimeout, R> =>
      Effect.gen(function* () {
        const workLimit = Duration.toMillis(options.duration);
        const wallLimit = Duration.toMillis(PROVIDER_CHUNK_WALL_LIMIT);
        const clock: ChunkClock = {
          startedAt: yield* Clock.currentTimeMillis,
          workLimitMs: workLimit,
          queuedMs: 0,
          queuedSince: 0,
          waiters: 0,
        };
        const watch = Effect.gen(function* () {
          while (true) {
            const now = yield* Clock.currentTimeMillis;
            const elapsed = now - clock.startedAt;
            const queued = queuedMs(clock, now);
            if (elapsed - queued >= workLimit)
              return yield* Effect.fail(options.onTimeout());
            if (elapsed >= wallLimit)
              return yield* new ProviderChunkWallTimeout({
                elapsedMs: elapsed,
                queuedMs: queued,
              });
            yield* Effect.sleep(
              Math.min(workLimit - (elapsed - queued), wallLimit - elapsed),
            );
          }
        });
        return yield* Effect.raceFirst(
          Effect.locally(chunk, CurrentChunkClock, clock),
          watch,
        );
      }),

  /** Marks `wait` as time queued for a shared host turn. Overlapping waits in
   * one chunk count once. Outside a chunk deadline this is `wait` unchanged. */
  queued: <A, E, R>(wait: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
    Effect.flatMap(FiberRef.get(CurrentChunkClock), (clock) =>
      clock === null
        ? wait
        : Effect.acquireUseRelease(
            Effect.flatMap(Clock.currentTimeMillis, (now) =>
              Effect.sync(() => {
                if (clock.waiters++ === 0) clock.queuedSince = now;
              }),
            ),
            () => wait,
            () =>
              Effect.flatMap(Clock.currentTimeMillis, (now) =>
                Effect.sync(() => {
                  if (--clock.waiters === 0)
                    clock.queuedMs += now - clock.queuedSince;
                }),
              ),
          ),
    ),

  /** The clock time by which a shared host turn in the current chunk must
   * finish, or none outside a chunk deadline. */
  turnHorizon: Effect.map(FiberRef.get(CurrentChunkClock), (clock) =>
    clock === null
      ? Option.none<number>()
      : Option.some(
          clock.startedAt +
            Duration.toMillis(PROVIDER_CHUNK_WALL_LIMIT) -
            Duration.toMillis(TURN_HORIZON_MARGIN),
        ),
  ),

  /** The latest clock time at which the current chunk may take a lease it
   * keeps until it ends: all of its remaining work allowance still ends by the
   * turn horizon, so the lease never runs the chunk into its wall limit. Time
   * spent waiting for the lease is queue time and leaves this unchanged. None
   * outside a chunk deadline. */
  leaseHorizon: Effect.flatMap(FiberRef.get(CurrentChunkClock), (clock) =>
    clock === null
      ? Effect.succeed(Option.none<number>())
      : Effect.map(Clock.currentTimeMillis, (now) =>
          Option.some(
            clock.startedAt +
              Duration.toMillis(PROVIDER_CHUNK_WALL_LIMIT) -
              Duration.toMillis(TURN_HORIZON_MARGIN) -
              (clock.workLimitMs -
                (now - clock.startedAt - queuedMs(clock, now))),
          ),
        ),
  ),

  /** Whether work taking up to `ms` from now ends by the chunk's turn
   * horizon. Requests outside a shared host turn that follow a late turn check
   * this first. Outside a chunk deadline everything fits. */
  fits: (ms: number): Effect.Effect<boolean> =>
    Effect.flatMap(
      ProviderChunkClock.turnHorizon,
      Option.match({
        onNone: () => Effect.succeed(true),
        onSome: (horizon) =>
          Effect.map(Clock.currentTimeMillis, (now) => now + ms <= horizon),
      }),
    ),

  /** The current chunk's remaining work allowance in ms, excluding time
   * queued for shared host turns and leases, or none outside a chunk
   * deadline. */
  workLeft: Effect.flatMap(FiberRef.get(CurrentChunkClock), (clock) =>
    clock === null
      ? Effect.succeed(Option.none<number>())
      : Effect.map(Clock.currentTimeMillis, (now) =>
          Option.some(
            clock.workLimitMs - (now - clock.startedAt - queuedMs(clock, now)),
          ),
        ),
  ),

  /** Whether work taking up to `ms` from now ends within the chunk's work
   * deadline, which excludes time queued for shared host turns. A request
   * that would otherwise fail the chunk at that deadline checks this first and
   * defers with stage `allowance` instead. Outside a chunk deadline everything
   * fits. */
  workFits: (ms: number): Effect.Effect<boolean> =>
    Effect.flatMap(FiberRef.get(CurrentChunkClock), (clock) =>
      clock === null
        ? Effect.succeed(true)
        : Effect.map(
            Clock.currentTimeMillis,
            (now) =>
              now - clock.startedAt - queuedMs(clock, now) + ms <=
              clock.workLimitMs,
          ),
    ),

  /** A deferral describing the current chunk's elapsed and queued time. */
  deferred: (host: string, stage: ProviderTurnDeferred["stage"]) =>
    Effect.flatMap(FiberRef.get(CurrentChunkClock), (clock) =>
      Effect.map(
        Clock.currentTimeMillis,
        (now) =>
          new ProviderTurnDeferred({
            host,
            stage,
            elapsedMs: clock === null ? 0 : now - clock.startedAt,
            queuedMs: clock === null ? 0 : queuedMs(clock, now),
          }),
      ),
    ),

  /**
   * For a request site where the chunk can stop and return a validated
   * checkpoint: a deferred turn becomes `Option.none()` once the chunk has
   * `advanced`, and the caller returns its checkpoint without the request.
   * Before any advance the deferral still fails, deferring the whole chunk.
   */
  unlessDeferred:
    (advanced: boolean) =>
    <A, E, R>(
      request: Effect.Effect<A, E, R>,
    ): Effect.Effect<Option.Option<A>, E, R> =>
      request.pipe(
        Effect.map(Option.some),
        // A predicate, not a refinement: before an advance the deferral is
        // still a failure of this effect.
        Effect.catchIf(
          (error: E): boolean =>
            advanced && error instanceof ProviderTurnDeferred,
          () => Effect.succeed(Option.none<A>()),
        ),
      ),

  /** Whether `error` defers the chunk rather than failing it. Connectors that
   * wrap their failures keep a deferral as it is. */
  isDeferral,

  /**
   * The deferral that failed a chunk run with `Effect.runPromise`, if that is
   * why it failed. Only a deferral that is the chunk's own failure counts; one
   * wrapped inside a provider error is a provider failure.
   */
  deferralOf: (error: unknown): ProviderChunkDeferral | null => {
    if (isDeferral(error)) return error;
    if (!Runtime.isFiberFailure(error)) return null;
    const failures = [...Cause.failures(error[Runtime.FiberFailureCauseId])];
    const deferral = failures[0];
    return failures.length === 1 && isDeferral(deferral) ? deferral : null;
  },
} as const;
