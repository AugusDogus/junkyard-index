import { Clock, Data, Duration, Effect, FiberRef } from "effect";

/**
 * Time accounting for one connector chunk.
 *
 * Shared provider host queues (`shared-provider-host.ts`) serialize every
 * request to a backend across all sources. Under the daily 07:00 contention a
 * request can wait minutes for its turn, so a deadline measured in wall time
 * fails chunks whose own provider work takes seconds. The chunk clock excludes
 * queue time from the work deadline while a separate wall limit keeps the chunk
 * inside one Vercel step.
 */
interface ChunkClock {
  readonly startedAt: number;
  /** Completed time during which at least one request waited for a turn. */
  queuedMs: number;
  queuedSince: number;
  waiters: number;
}

const CurrentChunkClock = FiberRef.unsafeMake<ChunkClock | null>(null);

/** Vercel steps for this project run at most 800 seconds. Leave room for the
 * checkpoint write that follows the provider chunk in the same step. */
export const PROVIDER_CHUNK_WALL_LIMIT = Duration.minutes(11);
/** After this much wall time, a chunk that already advanced stops queueing
 * further shared-host requests and returns its validated checkpoint. A request
 * started just before it still fits the wall limit at observed queue depths. */
export const PROVIDER_CHUNK_YIELD_AFTER = Duration.minutes(5);

export class ProviderChunkWallTimeout extends Data.TaggedError(
  "ProviderChunkWallTimeout",
)<{ elapsedMs: number; queuedMs: number }> {
  override get message() {
    return `Provider chunk reached its ${Duration.format(PROVIDER_CHUNK_WALL_LIMIT)} step allowance after ${Math.round(this.queuedMs / 1000)} s queued for shared host turns and ${Math.round((this.elapsedMs - this.queuedMs) / 1000)} s of provider work. No advanced checkpoint was accepted; prior inventory is preserved. The shared host queue is saturated; the step retries from the last validated checkpoint.`;
  }
}

const queuedMs = (clock: ChunkClock, now: number) =>
  clock.queuedMs + (clock.waiters > 0 ? now - clock.queuedSince : 0);

export const ProviderChunkClock = {
  /**
   * Like `Effect.timeoutFail`, but `duration` bounds only the chunk's own work:
   * time spent waiting for a shared provider host turn does not count. The
   * whole chunk still fails with `ProviderChunkWallTimeout` once it reaches
   * `PROVIDER_CHUNK_WALL_LIMIT` of wall time.
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

  /**
   * Whether a chunk that has processed `pagesProcessed` pages should stop
   * before its next request and return its validated checkpoint. Always false
   * before the first page, so every chunk makes progress, and outside a chunk
   * deadline.
   */
  shouldYield: (pagesProcessed: number): Effect.Effect<boolean> =>
    pagesProcessed < 1
      ? Effect.succeed(false)
      : Effect.flatMap(FiberRef.get(CurrentChunkClock), (clock) =>
          clock === null
            ? Effect.succeed(false)
            : Effect.map(
                Clock.currentTimeMillis,
                (now) =>
                  now - clock.startedAt >=
                  Duration.toMillis(PROVIDER_CHUNK_YIELD_AFTER),
              ),
        ),
} as const;
