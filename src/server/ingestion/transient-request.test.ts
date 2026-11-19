import { expect, test } from "bun:test";
import {
  Clock,
  type Duration,
  Effect,
  Fiber,
  TestClock,
  TestContext,
} from "effect";
import { ProviderRequestError, RequestTimeoutError } from "./errors";
import {
  findProviderCooldownError,
  isTransientRequestFailure,
  PROVIDER_COOLDOWN_MS,
  ProviderCooldownError,
  retryTransientRequest,
  transientStatusCause,
} from "./transient-request";

const context = "Yard https://yard.test/";
const answer = (status: number, headers: HeadersInit = {}) => ({
  status,
  headers: new Headers(headers),
});
const timeout = new DOMException("The operation timed out.", "TimeoutError");

test("transport failures and 5xx answers are transient, even when wrapped", () => {
  for (const failure of [
    new ProviderRequestError({ context, cause: new TypeError("fetch failed") }),
    new Error("received 503", transientStatusCause(context, answer(503))),
    new Error("outer", {
      cause: new Error(
        "received 500",
        transientStatusCause(context, answer(500)),
      ),
    }),
  ])
    expect(isTransientRequestFailure(failure, { timeouts: false })).toBe(true);
});

test("deadlines are transient only when the caller allows timeout retries", () => {
  for (const failure of [
    timeout,
    new RequestTimeoutError({ context, cause: "deadline" }),
    new Error("wrapped", { cause: timeout }),
  ]) {
    expect(isTransientRequestFailure(failure, { timeouts: true })).toBe(true);
    expect(isTransientRequestFailure(failure, { timeouts: false })).toBe(false);
  }
});

test("denials, redirects, decoding failures and interruptions are never transient", () => {
  for (const status of [301, 403, 404, 429, 501]) {
    expect(transientStatusCause(context, answer(status))).toBeUndefined();
    expect(
      isTransientRequestFailure(
        new Error(
          "received " + status,
          transientStatusCause(context, answer(status)),
        ),
        { timeouts: true },
      ),
    ).toBe(false);
  }
  for (const failure of [
    new TypeError("The encoded data was not valid for encoding utf-8"),
    new DOMException("aborted", "AbortError"),
    new Error("received 206"),
    null,
    "outcome unknown",
  ])
    expect(isTransientRequestFailure(failure, { timeouts: true })).toBe(false);
});

test("a 5xx answer carries its Retry-After", () => {
  expect(
    transientStatusCause(context, answer(503, { "Retry-After": "7" })),
  ).toMatchObject({
    cause: { status: 503, retryAfterMs: 7_000 },
  });
});

/** Runs `request` under the test clock, advancing it in `step`s until the
 * retries settle, and returns each attempt's virtual start time. */
function settle<A, E>(
  outcomes: readonly (() => Effect.Effect<A, E>)[],
  step: Duration.DurationInput = "1 second",
) {
  return Effect.gen(function* () {
    const starts: number[] = [];
    const request = Effect.gen(function* () {
      starts.push(yield* Clock.currentTimeMillis);
      const next = outcomes[starts.length - 1];
      if (!next) throw new Error("unexpected extra attempt");
      return yield* next();
    });
    const fiber = yield* Effect.fork(
      retryTransientRequest(request, { context, timeouts: false }),
    );
    for (let ticks = 0; ticks < 120; ticks++) {
      if ((yield* Fiber.poll(fiber))._tag === "Some") break;
      yield* TestClock.adjust(step);
    }
    return { starts, result: yield* Effect.either(Fiber.join(fiber)) };
  }).pipe(Effect.provide(TestContext.TestContext), Effect.runPromise);
}
const unavailable = (retryAfter?: string) => () =>
  Effect.fail(
    new Error(
      "received 503",
      transientStatusCause(
        context,
        answer(
          503,
          retryAfter === undefined ? {} : { "Retry-After": retryAfter },
        ),
      ),
    ),
  );

test("a short Retry-After replaces the in-chunk backoff when it is longer", async () => {
  const { starts, result } = await settle([
    unavailable("7"),
    () => Effect.succeed("page"),
  ]);
  expect(starts).toEqual([0, 7_000]);
  expect(result).toMatchObject({ _tag: "Right", right: "page" });
});

test("a Retry-After longer than a chunk can hold is not retried in-chunk and becomes a cooldown", async () => {
  const { starts, result } = await settle([unavailable("3600")]);
  expect(starts).toEqual([0]);
  if (result._tag !== "Left") throw new Error("expected a cooldown");
  expect(result.left).toBeInstanceOf(ProviderCooldownError);
  expect(findProviderCooldownError(result.left)?.retryAfterMs).toBe(3_600_000);
});

test("a failure still transient after the in-chunk retries becomes a cooldown of at least two minutes", async () => {
  const { starts, result } = await settle([
    unavailable(),
    unavailable(),
    unavailable(),
  ]);
  expect(starts).toEqual([0, 2_000, 6_000]);
  if (result._tag !== "Left") throw new Error("expected a cooldown");
  expect(findProviderCooldownError(result.left)?.retryAfterMs).toBe(
    PROVIDER_COOLDOWN_MS,
  );
  expect(result.left.message).toContain("received 503");
});

test("a non-transient failure passes through without a retry or cooldown", async () => {
  const denied = new Error("received 403");
  const { starts, result } = await settle([() => Effect.fail(denied)]);
  expect(starts).toEqual([0]);
  expect(result).toMatchObject({ _tag: "Left", left: denied });
});
