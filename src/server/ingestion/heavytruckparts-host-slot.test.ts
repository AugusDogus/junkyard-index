import { expect, test } from "bun:test";
import { Effect, Fiber, TestClock, TestContext } from "effect";
import {
  heavyTruckPartsHostSlot,
  withHeavyTruckPartsHostSlot,
  type HeavyTruckPartsHostStore,
} from "./heavytruckparts-host-slot";
import { HostReservation, ProviderHostStores } from "./provider-host-slot";

test("deployed clients fail before requesting when the lease store fails", async () => {
  const vercel = process.env.VERCEL;
  let requested = false;
  const failing: HeavyTruckPartsHostStore = {
    reserve: async () => {
      throw new Error("Lease store unavailable");
    },
    release: async () => true,
    cancel: async () => true,
  };
  try {
    process.env.VERCEL = "1";
    await ProviderHostStores.using(
      () => failing,
      async () => {
        await expect(
          Effect.runPromise(
            heavyTruckPartsHostSlot(
              Effect.sync(() => {
                requested = true;
              }),
            ),
          ),
        ).rejects.toThrow("reservation failed");
      },
    );
    expect(requested).toBe(false);
  } finally {
    if (vercel === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = vercel;
  }
});

function fakeStore() {
  let owner: string | null = null;
  const store: HeavyTruckPartsHostStore = {
    reserve: async (token, ttl) => {
      expect(ttl).toBe(90_000);
      if (owner !== null) return HostReservation.queued(0, 0);
      owner = token;
      return HostReservation.granted;
    },
    cancel: async () => true,
    release: async (token) => {
      if (owner !== token) return false;
      owner = null;
      return true;
    },
  };
  return store;
}

test.each([false, true])(
  "independent instances hold one host reservation through the body and completed gap (HTTP failure: %s)",
  async (fail) => {
    const store = fakeStore();
    const starts: string[] = [];
    const request = (name: string) =>
      Effect.gen(function* () {
        starts.push(name);
        yield* Effect.sleep("2 seconds"); // Simulate reading the complete body.
        if (fail) return yield* Effect.fail(new Error("HTTP 429"));
        return name;
      }).pipe(Effect.ensuring(Effect.sleep("4 seconds")));
    // Separate wrappers, no shared in-process semaphore, one atomic store.
    await Effect.runPromise(
      Effect.gen(function* () {
        const first = yield* Effect.fork(
          Effect.either(withHeavyTruckPartsHostSlot(store, request("cstruck"))),
        );
        const second = yield* Effect.fork(
          Effect.either(
            withHeavyTruckPartsHostSlot(store, request("heavytruckparts")),
          ),
        );
        yield* TestClock.adjust("5999 millis");
        expect(starts).toEqual(["cstruck"]);
        yield* TestClock.adjust("2001 millis");
        expect(starts).toEqual(["cstruck", "heavytruckparts"]);
        yield* TestClock.adjust("6 seconds");
        expect((yield* Fiber.join(first))._tag).toBe(fail ? "Left" : "Right");
        expect((yield* Fiber.join(second))._tag).toBe(fail ? "Left" : "Right");
      }).pipe(Effect.provide(TestContext.TestContext)),
    );
  },
);

test("a Redis reservation failure never executes the host request", async () => {
  let requested = false;
  const store = fakeStore();
  store.reserve = async () => {
    throw new Error("Redis unavailable");
  };
  await expect(
    Effect.runPromise(
      withHeavyTruckPartsHostSlot(
        store,
        Effect.sync(() => {
          requested = true;
        }),
      ),
    ),
  ).rejects.toThrow("reservation failed");
  expect(requested).toBe(false);
});

test("a busy host times out without executing a request", async () => {
  let requested = false;
  const store = {
    ...fakeStore(),
    reserve: async () => HostReservation.queued(0, 0),
  };
  await Effect.runPromise(
    Effect.gen(function* () {
      const fiber = yield* Effect.fork(
        Effect.either(
          withHeavyTruckPartsHostSlot(
            store,
            Effect.sync(() => {
              requested = true;
            }),
          ),
        ),
      );
      yield* TestClock.adjust("5 minutes");
      expect((yield* Fiber.join(fiber))._tag).toBe("Left");
      expect(requested).toBe(false);
    }).pipe(Effect.provide(TestContext.TestContext)),
  );
});

test("the request deadline releases the lease only after its completed gap", async () => {
  const store = fakeStore();
  await Effect.runPromise(
    Effect.gen(function* () {
      const fiber = yield* Effect.fork(
        Effect.either(
          withHeavyTruckPartsHostSlot(
            store,
            Effect.never.pipe(Effect.ensuring(Effect.sleep("4 seconds"))),
          ),
        ),
      );
      yield* TestClock.adjust("65 seconds");
      expect(
        yield* Effect.promise(() => store.reserve("other", 90_000)),
      ).toEqual(HostReservation.queued(0, 0));
      yield* TestClock.adjust("4 seconds");
      expect((yield* Fiber.join(fiber))._tag).toBe("Left");
      expect(
        yield* Effect.promise(() => store.reserve("other", 90_000)),
      ).toEqual(HostReservation.granted);
    }).pipe(Effect.provide(TestContext.TestContext)),
  );
});

test("lost ownership and Redis release failures fail the chunk after the request", async () => {
  for (const release of [
    async () => false,
    async () => {
      throw new Error("Redis unavailable");
    },
  ]) {
    const store = { ...fakeStore(), release };
    await expect(
      Effect.runPromise(
        withHeavyTruckPartsHostSlot(store, Effect.succeed("body")),
      ),
    ).rejects.toThrow("release failed");
  }
});

test("interruption retains the reservation until the completed gap then releases it", async () => {
  const store = fakeStore();
  await Effect.runPromise(
    Effect.gen(function* () {
      const first = yield* Effect.fork(
        withHeavyTruckPartsHostSlot(
          store,
          Effect.never.pipe(Effect.ensuring(Effect.sleep("4 seconds"))),
        ),
      );
      yield* TestClock.adjust("1 millis");
      const interrupted = yield* Effect.fork(Fiber.interrupt(first));
      yield* TestClock.adjust("3999 millis");
      expect(
        yield* Effect.promise(() => store.reserve("other", 90_000)),
      ).toEqual(HostReservation.queued(0, 0));
      yield* TestClock.adjust("1 millis");
      yield* Fiber.join(interrupted);
      expect(
        yield* Effect.promise(() => store.reserve("other", 90_000)),
      ).toEqual(HostReservation.granted);
    }).pipe(Effect.provide(TestContext.TestContext)),
  );
});
