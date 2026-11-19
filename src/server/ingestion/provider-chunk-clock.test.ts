import { afterEach, beforeEach, expect, test } from "bun:test";
import { Clock, Effect, Either, Fiber, TestClock, TestContext } from "effect";
import {
  ProviderChunkClock,
  ProviderChunkWallTimeout,
} from "./provider-chunk-clock";
import {
  providerHostSlot,
  withProviderHostSession,
  withProviderHostSlot,
  type ProviderHostPolicy,
  type ProviderHostStore,
} from "./provider-host-slot";

const policy: ProviderHostPolicy = {
  key: "offline",
  label: "offline",
  leaseMs: 130_000,
  requestMs: 110_000,
  waitMs: 30 * 60_000,
  pollMs: 1000,
  gapMs: 3500,
};

const deadline = ProviderChunkClock.deadline({
  duration: "3 minutes",
  onTimeout: () => new Error("work deadline"),
});

/** A store whose lease frees up once the test clock reaches `freeAt`. */
function busyUntil(freeAt: () => boolean) {
  let reservations = 0;
  const store: ProviderHostStore = {
    reserve: async () => {
      if (!freeAt()) return false;
      reservations++;
      return true;
    },
    release: async () => true,
    cancel: async () => true,
  };
  return { store, reservations: () => reservations };
}

const run = <A, E>(effect: Effect.Effect<A, E>) =>
  Effect.runPromise(effect.pipe(Effect.provide(TestContext.TestContext)));

test("time queued for a shared host turn does not spend the chunk's work deadline", async () => {
  // Production on 2026-11-19: about 20 sources shared the URG queue, so each
  // request waited minutes and three-minute chunks failed before eight GETs.
  const result = await run(
    Effect.gen(function* () {
      let now = 0;
      const { store, reservations } = busyUntil(() => now >= 4 * 60_000);
      const request = withProviderHostSlot(
        policy,
        store,
        Effect.sleep("2 seconds").pipe(Effect.as("page")),
      );
      const fiber = yield* Effect.fork(
        Effect.either(deadline(Effect.all([request, request]))),
      );
      while (fiber.unsafePoll() === null) {
        yield* TestClock.adjust("1 second");
        now += 1000;
      }
      return { exit: yield* Fiber.join(fiber), reservations: reservations() };
    }),
  );
  expect(result.exit).toEqual(Either.right(["page", "page"]));
  expect(result.reservations).toBe(2);
});

test("provider work beyond the deadline still fails the chunk", async () => {
  const result = await run(
    Effect.gen(function* () {
      const fiber = yield* Effect.fork(
        Effect.either(deadline(Effect.sleep("4 minutes"))),
      );
      yield* TestClock.adjust("3 minutes");
      return yield* Fiber.join(fiber);
    }),
  );
  expect(Either.isLeft(result) && result.left).toEqual(
    new Error("work deadline"),
  );
});

test("queue time still counts toward the step's wall limit", async () => {
  const result = await run(
    Effect.gen(function* () {
      const fiber = yield* Effect.fork(
        Effect.either(
          deadline(ProviderChunkClock.queued(Effect.sleep("20 minutes"))),
        ),
      );
      yield* TestClock.adjust("11 minutes");
      return yield* Fiber.join(fiber);
    }),
  );
  expect(Either.isLeft(result) && result.left).toBeInstanceOf(
    ProviderChunkWallTimeout,
  );
  expect(Either.isLeft(result) && result.left.message).toContain(
    "660 s queued for shared host turns",
  );
});

test("overlapping waits in one chunk count once", async () => {
  const result = await run(
    Effect.gen(function* () {
      const wait = ProviderChunkClock.queued(Effect.sleep("4 minutes"));
      const fiber = yield* Effect.fork(
        Effect.either(
          deadline(
            Effect.all([wait, wait], { concurrency: 2 }).pipe(
              Effect.andThen(Effect.sleep("2 minutes")),
            ),
          ),
        ),
      );
      yield* TestClock.adjust("6 minutes");
      return yield* Fiber.join(fiber);
    }),
  );
  expect(Either.isRight(result)).toBe(true);
});

test("a chunk yields only after it advanced and spent its wall share", async () => {
  const outside = await run(ProviderChunkClock.shouldYield(8));
  const observed = await run(
    Effect.gen(function* () {
      const fiber = yield* Effect.fork(
        deadline(
          Effect.gen(function* () {
            const early = yield* ProviderChunkClock.shouldYield(1);
            yield* ProviderChunkClock.queued(Effect.sleep("5 minutes"));
            return {
              early,
              noProgress: yield* ProviderChunkClock.shouldYield(0),
              late: yield* ProviderChunkClock.shouldYield(1),
            };
          }),
        ),
      );
      yield* TestClock.adjust("5 minutes");
      return yield* Fiber.join(fiber);
    }),
  );
  expect(outside).toBe(false);
  expect(observed).toEqual({ early: false, noProgress: false, late: true });
});

let vercel: string | undefined;
beforeEach(() => {
  vercel = process.env.VERCEL;
  process.env.VERCEL = "1";
});
afterEach(() => {
  if (vercel === undefined) delete process.env.VERCEL;
  else process.env.VERCEL = vercel;
});

test("a host session waits once and keeps the gap between its requests", async () => {
  const result = await run(
    Effect.gen(function* () {
      let reservations = 0;
      const store: ProviderHostStore = {
        reserve: async () => {
          reservations++;
          return true;
        },
        release: async () => true,
        cancel: async () => true,
      };
      const finished: number[] = [];
      const request = providerHostSlot(
        policy,
        Effect.sleep("1 second").pipe(
          Effect.andThen(Clock.currentTimeMillis),
          Effect.tap((at) => Effect.sync(() => finished.push(at))),
        ),
      );
      const fiber = yield* Effect.fork(
        withProviderHostSession(
          policy,
          store,
          "3 minutes",
          Effect.all([request, request, request]),
        ),
      );
      yield* TestClock.adjust("1 minute");
      yield* Fiber.join(fiber);
      return { reservations, finished };
    }),
  );
  expect(result.reservations).toBe(1);
  expect(result.finished).toEqual([1000, 5500, 10_000]);
});
