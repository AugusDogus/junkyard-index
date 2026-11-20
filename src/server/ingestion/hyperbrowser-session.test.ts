import { expect, test } from "bun:test";
import { Effect, Fiber, TestClock, TestContext } from "effect";
import type { CreateSessionParams } from "@hyperbrowser/sdk/types";
import { BrowserSessionError } from "./errors";
import {
  createHyperbrowserSession,
  findHyperbrowserCapacityError,
  HYPERBROWSER_SESSION_POLICY,
  HYPERBROWSER_SESSION_TIMEOUT_MINUTES,
  HyperbrowserCapacityError,
  withHyperbrowserSessionLease,
} from "./hyperbrowser-session";
import { withProviderHostSlot } from "./provider-host-slot";

/** The SDK error as production raised it on 2026-11-18 and 2026-11-19. */
function sessionLimitError() {
  const error = new Error(
    "[Hyperbrowser]: Maximum number of active sessions (1) reached. Please close some sessions before creating new ones.",
  );
  error.name = "HyperbrowserError";
  return error;
}
const opened = { id: "session-1", wsEndpoint: "wss://browser" };
function sessions(outcomes: (() => Promise<unknown>)[]) {
  const calls: (CreateSessionParams | undefined)[] = [];
  return {
    calls,
    create(params?: CreateSessionParams) {
      calls.push(params);
      const next = outcomes[calls.length - 1];
      if (!next) throw new Error("unexpected extra session request");
      return next().then(() => opened);
    },
  };
}

test("a browser session waits out the plan's one-session limit, then opens with a lifetime cap", async () => {
  const client = sessions([
    () => Promise.reject(sessionLimitError()),
    () => Promise.reject(sessionLimitError()),
    () => Promise.resolve(),
  ]);
  const session = await Effect.runPromise(
    Effect.gen(function* () {
      const fiber = yield* Effect.fork(
        createHyperbrowserSession(client, { useStealth: true }),
      );
      yield* TestClock.adjust("20 seconds");
      return yield* Fiber.join(fiber);
    }).pipe(Effect.provide(TestContext.TestContext)),
  );
  expect(session.id).toBe("session-1");
  expect(client.calls).toHaveLength(3);
  expect(client.calls[0]).toEqual({
    useStealth: true,
    timeoutMinutes: HYPERBROWSER_SESSION_TIMEOUT_MINUTES,
  });
});

test("a session limit that outlasts the poll becomes a deferrable capacity error", async () => {
  const client = sessions(
    Array.from({ length: 7 }, () => () => Promise.reject(sessionLimitError())),
  );
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const fiber = yield* Effect.fork(
        createHyperbrowserSession(client, {}).pipe(Effect.either),
      );
      yield* TestClock.adjust("60 seconds");
      return yield* Fiber.join(fiber);
    }).pipe(Effect.provide(TestContext.TestContext)),
  );
  expect(client.calls).toHaveLength(7);
  expect(result._tag).toBe("Left");
  if (result._tag === "Left")
    expect(result.left).toBeInstanceOf(HyperbrowserCapacityError);
});

test("other session failures are not treated as capacity", async () => {
  const client = sessions([
    () => Promise.reject(new Error("[Hyperbrowser]: Invalid API key")),
  ]);
  const result = await Effect.runPromise(
    createHyperbrowserSession(client, {}).pipe(Effect.either),
  );
  expect(client.calls).toHaveLength(1);
  expect(result._tag).toBe("Left");
  if (result._tag === "Left") {
    expect(result.left).not.toBeInstanceOf(HyperbrowserCapacityError);
    expect(result.left.message).toContain("Invalid API key");
  }
});

test("a browser lease still held by another source defers instead of running", async () => {
  let ran = false;
  const busy = {
    reserve: async () => false,
    release: async () => true,
    cancel: async () => true,
  };
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const fiber = yield* Effect.fork(
        withHyperbrowserSessionLease(
          Effect.sync(() => {
            ran = true;
          }),
          (effect) =>
            withProviderHostSlot(HYPERBROWSER_SESSION_POLICY, busy, effect),
        ).pipe(Effect.either),
      );
      yield* TestClock.adjust(HYPERBROWSER_SESSION_POLICY.waitMs);
      return yield* Fiber.join(fiber);
    }).pipe(Effect.provide(TestContext.TestContext)),
  );
  expect(ran).toBe(false);
  expect(result._tag).toBe("Left");
  if (result._tag === "Left")
    expect(result.left).toBeInstanceOf(HyperbrowserCapacityError);
});

test("capacity survives the wrappers that connectors and the Effect runtime add", async () => {
  const capacity = new HyperbrowserCapacityError({
    reason: "busy",
    retryAfterMs: 120_000,
  });
  const fiberFailure = await Effect.runPromise(Effect.fail(capacity)).catch(
    (error: unknown) => error,
  );
  for (const wrapped of [
    capacity,
    fiberFailure,
    new BrowserSessionError({ phase: "open", cause: capacity }),
    new Error("Vander Haags ingestion failed", { cause: capacity }),
    new AggregateError([new Error("cleanup"), capacity]),
  ])
    expect(findHyperbrowserCapacityError(wrapped)).toBe(capacity);
  expect(findHyperbrowserCapacityError(new Error("HTTP 403"))).toBeNull();
});
