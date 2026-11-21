import { expect, test } from "bun:test";
import {
  Clock,
  Effect,
  Either,
  Fiber,
  Option,
  TestClock,
  TestContext,
} from "effect";
import {
  ProviderCapacityDeferred,
  ProviderChunkClock,
  ProviderChunkWallTimeout,
  ProviderTurnDeferred,
} from "./provider-chunk-clock";
import {
  providerHostLease,
  providerHostSlot,
  providerHostTurn,
  withProviderHostLease,
  withProviderHostSlot,
  withProviderHostTurn,
  type ProviderHostPolicy,
  type ProviderHostStore,
  type ProviderLeasePolicy,
} from "./provider-host-slot";
import { runWithQueuedHost } from "./provider-host-test-support";

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
      yield* TestClock.adjust("6 minutes");
      return yield* Fiber.join(fiber);
    }),
  );
  expect(Either.isLeft(result) && result.left).toBeInstanceOf(
    ProviderChunkWallTimeout,
  );
  expect(Either.isLeft(result) && result.left.message).toContain(
    "360 s queued for shared host turns",
  );
});

test("overlapping waits in one chunk count once", async () => {
  const result = await run(
    Effect.gen(function* () {
      const wait = ProviderChunkClock.queued(Effect.sleep("3 minutes"));
      const fiber = yield* Effect.fork(
        Effect.either(
          deadline(
            Effect.all([wait, wait], { concurrency: 2 }).pipe(
              Effect.andThen(Effect.sleep("2 minutes")),
            ),
          ),
        ),
      );
      yield* TestClock.adjust("5 minutes");
      return yield* Fiber.join(fiber);
    }),
  );
  expect(Either.isRight(result)).toBe(true);
});

const page = (label: string) =>
  providerHostSlot(
    policy,
    Effect.sleep("2 seconds").pipe(
      Effect.andThen(Clock.currentTimeMillis),
      Effect.map((at) => `${label}@${at}`),
    ),
  );

test("a turn waits once and keeps the gap between its requests", async () => {
  const run = await runWithQueuedHost(
    deadline(
      providerHostTurn(
        policy,
        3,
        Effect.all([page("owner"), page("anchor"), page("page")]),
      ),
    ),
    { turnWaitMs: 2 * 60_000 },
  );
  expect(run.result).toEqual(
    Either.right(["owner@122000", "anchor@127500", "page@133000"]),
  );
  expect(run.turns).toHaveLength(1);
  // The lease covers the three requests, each followed by one 3.5 s gap
  // (released at 136.5 s, seen at the next simulated second), and no more.
  expect(run.turns[0]?.releasedAt).toBe(137_000);
}, 60_000);

test("a turn holds the policy gap after requests that took no host slot of their own", async () => {
  // URG IIS takes a turn around its raw fetch. Releasing the lease when the
  // body ends let the next URG source hit the shared backend at once.
  const raw = Effect.sleep("2 seconds").pipe(
    Effect.andThen(Clock.currentTimeMillis),
  );
  for (const turn of [
    providerHostTurn(policy, 1, raw),
    deadline(providerHostTurn(policy, 1, raw)),
    // A raw request after a slotted one in the same turn.
    deadline(
      providerHostTurn(policy, 2, page("slot").pipe(Effect.andThen(raw))),
    ),
  ]) {
    const run = await runWithQueuedHost(turn, { turnWaitMs: 60_000 });
    if (Either.isLeft(run.result)) throw run.result.left;
    const releasedAt = run.turns[0]?.releasedAt ?? 0;
    expect(run.turns).toHaveLength(1);
    expect(releasedAt - run.result.right).toBeGreaterThanOrEqual(policy.gapMs);
    // No second gap is added after the policy gap.
    expect(releasedAt - run.result.right).toBeLessThan(policy.gapMs + 1000);
  }
}, 60_000);

test("a turn that cannot arrive before the chunk's horizon is deferred and gives up its place", async () => {
  const run = await runWithQueuedHost(deadline(page("late")), {
    turnWaitMs: 7 * 60_000,
  });
  expect(Either.isLeft(run.result) && run.result.left).toBeInstanceOf(Error);
  const deferred = await runWithQueuedHost(
    deadline(providerHostTurn(policy, 1, page("late"))),
    { turnWaitMs: 7 * 60_000 },
  );
  expect(Either.isLeft(deferred.result) && deferred.result.left).toBeInstanceOf(
    ProviderTurnDeferred,
  );
  expect(deferred.turns).toHaveLength(0);
  expect(deferred.cancelled).toBe(1);
  // Waiting stops early enough for the estimated request to still fit.
  expect(deferred.elapsedMs).toBeLessThan(6 * 60_000 - 20_000);
}, 60_000);

test("work still running at the chunk's horizon is interrupted, deferred and releases its lease", async () => {
  const run = await runWithQueuedHost(
    deadline(
      providerHostTurn(
        policy,
        2,
        Effect.all([page("first"), Effect.sleep("10 minutes")]),
      ),
    ),
    { turnWaitMs: 4 * 60_000 },
  );
  expect(Either.isLeft(run.result) && run.result.left).toBeInstanceOf(
    ProviderTurnDeferred,
  );
  expect(run.turns).toHaveLength(1);
  expect(run.turns[0]?.releasedAt).not.toBeNull();
  expect(run.turns[0]?.releasedAt ?? Infinity).toBeLessThanOrEqual(6 * 60_000);
}, 60_000);

test("a deferred turn ends an advanced chunk early and defers one that has not advanced", async () => {
  const deferred = new ProviderTurnDeferred({
    host: "offline",
    stage: "wait",
    elapsedMs: 0,
    queuedMs: 0,
  });
  const advanced = await run(
    ProviderChunkClock.unlessDeferred(true)(Effect.fail(deferred)),
  );
  const fresh = await run(
    Effect.either(
      ProviderChunkClock.unlessDeferred(false)(Effect.fail(deferred)),
    ),
  );
  const other = await run(
    Effect.either(
      ProviderChunkClock.unlessDeferred(true)(
        Effect.fail(new Error("HTTP 500")),
      ),
    ),
  );
  expect(advanced).toEqual(Option.none());
  expect(fresh).toEqual(Either.left(deferred));
  expect(other).toEqual(Either.left(new Error("HTTP 500")));
});

test("only a deferral that failed the chunk itself defers it", async () => {
  const deferred = new ProviderTurnDeferred({
    host: "offline",
    stage: "wait",
    elapsedMs: 0,
    queuedMs: 0,
  });
  const failure = (effect: Effect.Effect<never, unknown>) =>
    Effect.runPromise(effect).catch((error: unknown) => error);
  expect(
    ProviderChunkClock.deferralOf(await failure(Effect.fail(deferred))),
  ).toBe(deferred);
  expect(
    ProviderChunkClock.deferralOf(
      await failure(Effect.fail(new Error("provider", { cause: deferred }))),
    ),
  ).toBeNull();
  expect(ProviderChunkClock.deferralOf(new Error("HTTP 500"))).toBeNull();
  const capacity = new ProviderCapacityDeferred({
    provider: "Hyperbrowser",
    detail: "Maximum number of active sessions (1) reached.",
  });
  expect(
    ProviderChunkClock.deferralOf(await failure(Effect.fail(capacity))),
  ).toBe(capacity);
  // The chunk deadline races the chunk against its watch; the deferral is
  // still the run's only failure.
  expect(
    ProviderChunkClock.deferralOf(
      await failure(deadline(Effect.fail(deferred))),
    ),
  ).toBe(deferred);
});

test("a reservation still in flight when the turn's wait budget ends is never left holding the lease", async () => {
  // Near the horizon a turn may wait only milliseconds. An Upstash round trip
  // can outlast that and still grant the lease, which must then be released.
  let granted = false,
    released = false;
  const store: ProviderHostStore = {
    reserve: async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      granted = true;
      return true;
    },
    release: async () => {
      released = true;
      return true;
    },
    cancel: async () => true,
  };
  await run(
    Effect.gen(function* () {
      const fiber = yield* Effect.fork(
        Effect.either(
          deadline(
            ProviderChunkClock.queued(Effect.sleep(331_450)).pipe(
              Effect.andThen(
                withProviderHostTurn(policy, store, 1, Effect.void),
              ),
            ),
          ),
        ),
      );
      yield* TestClock.adjust(331_450);
      while (fiber.unsafePoll() === null) {
        yield* Effect.promise(
          () => new Promise<void>((resolve) => setTimeout(resolve, 5)),
        );
        yield* TestClock.adjust("1 second");
      }
    }),
  );
  expect(granted).toBe(true);
  expect(released).toBe(true);
}, 60_000);

/** What `work` alone settles to. */
const settled = (work: Effect.Effect<void, Error>) =>
  Effect.runSync(Effect.either(work));

const leasePolicy: ProviderLeasePolicy = {
  key: "browser",
  label: "browser session",
  leaseMs: 11 * 60_000,
  waitMs: 5 * 60_000,
  pollMs: 1000,
};

test("a scoped lease waits its turn without spending work time and is held until its scope closes, on success or failure", async () => {
  for (const work of [Effect.void, Effect.fail(new Error("refused"))]) {
    const run = await runWithQueuedHost(
      deadline(
        Effect.scoped(
          providerHostLease(leasePolicy).pipe(
            Effect.andThen(Effect.sleep("170 seconds")),
            Effect.andThen(work),
          ),
        ),
      ),
      { turnWaitMs: 90_000 },
    );
    // 90 s queued plus 170 s of work fits the three-minute work deadline.
    expect(run.result).toEqual(settled(work));
    expect(run.turns).toHaveLength(1);
    expect(run.turns[0]?.acquiredAt).toBe(90_000);
    expect(run.turns[0]?.leaseMs).toBe(leasePolicy.leaseMs);
    const releasedAt = run.turns[0]?.releasedAt ?? 0;
    expect(releasedAt).toBeGreaterThanOrEqual(260_000);
    expect(releasedAt).toBeLessThan(263_000);
  }
}, 60_000);

test("a busy lease defers once the chunk's remaining work would no longer fit, and gives up its place", async () => {
  const run = await runWithQueuedHost(
    deadline(Effect.scoped(providerHostLease(leasePolicy))),
    { turnWaitMs: 7 * 60_000 },
  );
  expect(Either.isLeft(run.result) && run.result.left).toBeInstanceOf(
    ProviderTurnDeferred,
  );
  expect(run.turns).toHaveLength(0);
  expect(run.cancelled).toBe(1);
  // The horizon is 340 s; three minutes of work must still fit after it.
  expect(run.elapsedMs).toBeGreaterThan(150_000);
  expect(run.elapsedMs).toBeLessThanOrEqual(162_000);
}, 60_000);

test("a lease is never awaited inside a shared host turn, so a turn holder cannot wait on a lease holder", async () => {
  const reserved: string[] = [];
  const store: ProviderHostStore = {
    reserve: async (token) => {
      reserved.push(token);
      return true;
    },
    release: async () => true,
    cancel: async () => true,
  };
  const result = await Effect.runPromise(
    Effect.either(
      withProviderHostTurn(
        { ...policy, gapMs: 0 },
        store,
        1,
        Effect.scoped(withProviderHostLease(leasePolicy, store)),
      ),
    ),
  );
  expect(Either.isLeft(result) && result.left.message).toContain(
    "inside a shared host turn",
  );
  // Only the turn reserved.
  expect(reserved).toHaveLength(1);
});
