import { expect, spyOn, test } from "bun:test";
import { Clock, Effect, Fiber, TestClock, TestContext } from "effect";
import {
  HostReservation,
  providerHostSlot,
  withProviderHostSlot,
  type ProviderHostPolicy,
} from "./provider-host-slot";

const policy: ProviderHostPolicy = {
  key: "offline",
  label: "offline",
  leaseMs: 90_000,
  requestMs: 65_000,
  waitMs: 10_000,
  pollMs: 1000,
  gapMs: 3500,
};

test("an interrupted waiter cancels its queue entry without releasing an uncertain lease", async () => {
  const cancelled: string[] = [];
  let releases = 0,
    requests = 0;
  await Effect.runPromise(
    Effect.gen(function* () {
      const fiber = yield* Effect.fork(
        withProviderHostSlot(
          policy,
          {
            reserve: async () => HostReservation.queued(0, 0),
            release: async () => {
              releases++;
              return true;
            },
            cancel: async (token) => {
              cancelled.push(token);
              return true;
            },
          },
          Effect.sync(() => {
            requests++;
          }),
        ),
      );
      yield* TestClock.adjust("1 second");
      yield* Fiber.interrupt(fiber);
    }).pipe(Effect.provide(TestContext.TestContext)),
  );
  expect(cancelled).toHaveLength(1);
  expect(releases).toBe(0);
  expect(requests).toBe(0);
});

test("shared backend retains its lease through response completion and the failure gap", async () => {
  let release = false;
  await Effect.runPromise(
    Effect.gen(function* () {
      const fiber = yield* Effect.fork(
        Effect.either(
          withProviderHostSlot(
            policy,
            {
              reserve: async () => HostReservation.granted,
              release: async () => {
                release = true;
                return true;
              },
              cancel: async () => true,
            },
            Effect.sleep("2 seconds").pipe(
              Effect.andThen(Effect.fail(new Error("HTTP 500"))),
            ),
          ),
        ),
      );
      yield* TestClock.adjust("5499 millis");
      expect(release).toBe(false);
      yield* TestClock.adjust("1 millis");
      expect((yield* Fiber.join(fiber))._tag).toBe("Left");
      expect(release).toBe(true);
    }).pipe(Effect.provide(TestContext.TestContext)),
  );
});

test("a waiter sleeps longer between polls the more turns stand ahead of it", async () => {
  // Behind three turns of its lane twice, then behind six ready lanes for one
  // of four group places, then among the first four ready lanes, then at the
  // front of a held lane.
  const places = [
    HostReservation.queued(3, 0),
    HostReservation.queued(3, 0),
    HostReservation.queued(0, 6),
    HostReservation.queued(0, 2),
    HostReservation.queued(0, 0),
    HostReservation.granted,
  ];
  let now = 0;
  const polledAt: number[] = [];
  await Effect.runPromise(
    Effect.gen(function* () {
      const fiber = yield* Effect.fork(
        withProviderHostSlot(
          { ...policy, waitMs: 60_000, group: { key: "g", activeLanes: 4 } },
          {
            reserve: async () => {
              polledAt.push(now);
              return places[polledAt.length - 1] ?? HostReservation.granted;
            },
            release: async () => true,
            cancel: async () => true,
          },
          Effect.void,
        ),
      );
      // The first poll happens before the clock moves.
      yield* TestClock.adjust("0 millis");
      while (polledAt.length < places.length) {
        now += 250;
        yield* TestClock.adjust("250 millis");
      }
      yield* TestClock.adjust("10 seconds");
      yield* Fiber.join(fiber);
    }).pipe(Effect.provide(TestContext.TestContext)),
  );
  // Each turn ahead holds the lane for at least the 3.5 s gap, and four
  // places share the ready lanes' turns. The first four releases can come at
  // any moment, so a ready lane among the first four polls every pollMs.
  // Sleeps stop at 10 s, so a waiter renews its 30 s queue deadline in time.
  expect(
    polledAt.slice(1).map((at, index) => at - (polledAt[index] ?? 0)),
  ).toEqual([10_000, 10_000, 2_750, 1_000, 1_000]);
});

test("a waiter never sleeps past the end of its wait", async () => {
  const polls: number[] = [];
  await Effect.runPromise(
    Effect.gen(function* () {
      const fiber = yield* Effect.fork(
        Effect.either(
          withProviderHostSlot(
            { ...policy, waitMs: 15_000 },
            {
              reserve: async () => {
                polls.push(polls.length);
                return HostReservation.queued(5, 0);
              },
              release: async () => true,
              cancel: async () => true,
            },
            Effect.void,
          ),
        ),
      );
      yield* TestClock.adjust("15 seconds");
      expect((yield* Fiber.join(fiber))._tag).toBe("Left");
    }).pipe(Effect.provide(TestContext.TestContext)),
  );
  // Polls at 0 s, 10 s (capped sleep) and 15 s (the end of the wait).
  expect(polls).toHaveLength(3);
});

/** Billed Upstash commands for `run`: each script plus every command it ran. */

test("a deployed gate keeps one request at a time and the gap in process, with no Redis", async () => {
  const environment = {
    VERCEL: process.env.VERCEL,
    UPSTASH_REDIS_REST_URL: process.env.UPSTASH_REDIS_REST_URL,
    UPSTASH_REDIS_REST_TOKEN: process.env.UPSTASH_REDIS_REST_TOKEN,
  };
  const fetch = spyOn(globalThis, "fetch").mockRejectedValue(
    new Error("No network requests allowed"),
  );
  const requests: { startedAt: number; endedAt: number }[] = [];
  const request = Effect.gen(function* () {
    const startedAt = yield* Clock.currentTimeMillis;
    yield* Effect.sleep("1 second");
    requests.push({ startedAt, endedAt: yield* Clock.currentTimeMillis });
  });
  const lane = { ...policy, key: "in-process-gap" };
  try {
    process.env.VERCEL = "1";
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    await Effect.runPromise(
      Effect.gen(function* () {
        const fiber = yield* Effect.fork(
          Effect.all(
            [providerHostSlot(lane, request), providerHostSlot(lane, request)],
            { concurrency: 2 },
          ),
        );
        yield* TestClock.adjust("30 seconds");
        yield* Fiber.join(fiber);
      }).pipe(Effect.provide(TestContext.TestContext)),
    );
  } finally {
    fetch.mockRestore();
    for (const [key, value] of Object.entries(environment))
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
  }
  const [first, second] = requests;
  if (!first || !second) throw new Error("Expected two requests");
  expect(second.startedAt - first.endedAt).toBeGreaterThanOrEqual(lane.gapMs);
  expect(fetch).not.toHaveBeenCalled();
});
