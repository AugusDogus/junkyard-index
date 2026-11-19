import { afterEach, expect, test } from "bun:test";
import { Clock, Effect, Fiber, TestClock, TestContext } from "effect";
import {
  CHASENCARS_MAX_BODY_BYTES,
  ChasencarsProviderError,
  chasencarsRequestGate,
  readChasencarsPage,
} from "./chasencars-client";
import { findProviderCooldownError } from "./transient-request";
import type { ProviderRequestGate } from "./provider-http-client";

const originalFetch = globalThis.fetch;
const direct: ProviderRequestGate = (request) => request;
const url = "https://chasencarsauto.com/inventory/";
afterEach(() => {
  globalThis.fetch = originalFetch;
});
function stub(run: (url: string, options?: RequestInit) => Promise<Response>) {
  globalThis.fetch = Object.assign(
    async (input: string | URL | Request, options?: RequestInit) =>
      run(input instanceof Request ? input.url : String(input), options),
    { preconnect: originalFetch.preconnect },
  );
}
test("Chase N Cars performs one bounded manual GET and consumes its full native body", async () => {
  const calls: RequestInit[] = [];
  stub(async (_url, options) => {
    if (options) calls.push(options);
    return new Response("<html>native body</html>", {
      headers: { "content-type": "text/html" },
    });
  });
  expect(await Effect.runPromise(readChasencarsPage(url, direct))).toBe(
    "<html>native body</html>",
  );
  expect(calls).toHaveLength(1);
  expect(calls[0]?.redirect).toBe("manual");
  expect(calls[0]?.signal?.aborted).toBe(true);
});
test("Chase N Cars refuses foreign/detail destinations, denied/challenge/redirect boundaries, partial bytes and unknown outcomes without retry", async () => {
  let calls = 0;
  stub(async () => {
    calls++;
    return new Response("unused");
  });
  for (const target of [
    "https://foreign.test/used-parts/ACURA",
    url + "?page=2",
    url + "/MDX/AD4656/2017",
    "https://chasencarsauto.com/wp-json/",
  ])
    expect(
      (
        await Effect.runPromise(
          Effect.either(readChasencarsPage(target, direct)),
        )
      )._tag,
    ).toBe("Left");
  expect(calls).toBe(0);
  for (const response of [
    new Response("redirect", {
      status: 301,
      headers: { location: "https://foreign.test/" },
    }),
    new Response("challenge", { status: 403 }),
    new Response("partial", { status: 206 }),
    new Response("{}", { headers: { "content-type": "application/json" } }),
    new Response("partial", {
      headers: {
        "content-type": "text/html",
        "content-range": "bytes 0-6/100",
      },
    }),
    new Response("short", {
      headers: { "content-type": "text/html", "content-length": "100" },
    }),
    new Response("x".repeat(CHASENCARS_MAX_BODY_BYTES + 1), {
      headers: { "content-type": "text/html" },
    }),
  ]) {
    calls = 0;
    stub(async () => {
      calls++;
      return response;
    });
    expect(
      (await Effect.runPromise(Effect.either(readChasencarsPage(url, direct))))
        ._tag,
    ).toBe("Left");
    expect(calls).toBe(1);
    expect(response.body?.locked).toBe(false);
  }
  calls = 0;
  stub(async () => {
    calls++;
    throw new Error("original-call outcome unknown");
  });
  const unknown = await Effect.runPromise(
    Effect.either(readChasencarsPage(url, direct)),
  );
  expect(unknown).toMatchObject({
    _tag: "Left",
    left: { message: expect.stringContaining("original-call outcome unknown") },
  });
  expect(calls).toBe(1);
});
test("Chase N Cars combined body deadline aborts each stalled stream and retries it twice", async () => {
  const responses: Response[] = [];
  let canceled = 0;
  stub(async () => {
    const response = new Response(
      new ReadableStream<Uint8Array>({
        cancel() {
          canceled++;
        },
      }),
      { headers: { "content-type": "text/html" } },
    );
    responses.push(response);
    return response;
  });
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const fiber = yield* Effect.fork(readChasencarsPage(url, direct));
      for (const step of [
        "20 seconds",
        "2 seconds",
        "20 seconds",
        "4 seconds",
        "20 seconds",
      ] as const) {
        yield* Effect.promise(
          () => new Promise((resolve) => setTimeout(resolve, 5)),
        );
        yield* TestClock.adjust(step);
      }
      return yield* Effect.either(Fiber.join(fiber));
    }).pipe(Effect.provide(TestContext.TestContext)),
  );
  expect(result).toMatchObject({
    _tag: "Left",
    left: {
      message: expect.stringContaining("Combined request and body deadline"),
    },
  });
  expect(responses).toHaveLength(3);
  expect(canceled).toBe(3);
  expect(responses.every((response) => !response.body?.locked)).toBe(true);
});
test("Chase N Cars retries 5xx answers and transport failures, then succeeds", async () => {
  const outcomes: (() => Response)[] = [
    () => new Response("unavailable", { status: 503 }),
    () => {
      throw new TypeError("fetch failed");
    },
    () =>
      new Response("<html>native body</html>", {
        headers: { "content-type": "text/html" },
      }),
  ];
  let calls = 0;
  stub(async () => {
    const next = outcomes[calls++];
    if (!next) throw new Error("unexpected extra request");
    return next();
  });
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const fiber = yield* Effect.fork(readChasencarsPage(url, direct));
      for (const step of ["2 seconds", "4 seconds"] as const) {
        yield* Effect.promise(
          () => new Promise((resolve) => setTimeout(resolve, 5)),
        );
        yield* TestClock.adjust(step);
      }
      return yield* Fiber.join(fiber);
    }).pipe(Effect.provide(TestContext.TestContext)),
  );
  expect(result).toBe("<html>native body</html>");
  expect(calls).toBe(3);
});
test("Chase N Cars gives up after three 5xx answers", async () => {
  let calls = 0;
  stub(async () => {
    calls++;
    return new Response("unavailable", { status: 500 });
  });
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const fiber = yield* Effect.fork(readChasencarsPage(url, direct));
      for (const step of ["2 seconds", "4 seconds"] as const) {
        yield* Effect.promise(
          () => new Promise((resolve) => setTimeout(resolve, 5)),
        );
        yield* TestClock.adjust(step);
      }
      return yield* Effect.either(Fiber.join(fiber));
    }).pipe(Effect.provide(TestContext.TestContext)),
  );
  expect(result).toMatchObject({
    _tag: "Left",
    left: { message: expect.stringContaining("received HTTP500") },
  });
  expect(calls).toBe(3);
});
test("Chase N Cars shared gate serializes chunks with 1600ms padding, including failures", async () => {
  const starts: number[] = [];
  await Effect.runPromise(
    Effect.gen(function* () {
      const request = chasencarsRequestGate(
        Effect.gen(function* () {
          starts.push(yield* Clock.currentTimeMillis);
          return yield* Effect.fail("failed");
        }),
      ).pipe(Effect.either);
      const first = yield* Effect.fork(request),
        second = yield* Effect.fork(request);
      yield* TestClock.adjust("3200 millis");
      yield* Fiber.join(first);
      yield* Fiber.join(second);
    }).pipe(Effect.provide(TestContext.TestContext)),
  );
  expect(starts).toHaveLength(2);
  expect((starts[1] ?? 0) - (starts[0] ?? 0)).toBe(1600);
});
test("Chase N Cars stops at a 503 asking for a long wait and hands the workflow its Retry-After", async () => {
  let calls = 0;
  stub(async () => {
    calls++;
    return new Response("maintenance", {
      status: 503,
      headers: { "Retry-After": "3600" },
    });
  });
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const fiber = yield* Effect.fork(readChasencarsPage(url, direct));
      for (const step of ["2 seconds", "4 seconds", "1 minute"] as const) {
        yield* Effect.promise(
          () => new Promise((resolve) => setTimeout(resolve, 5)),
        );
        yield* TestClock.adjust(step);
      }
      return yield* Effect.either(Fiber.join(fiber));
    }).pipe(Effect.provide(TestContext.TestContext)),
  );
  expect(calls).toBe(1);
  if (result._tag !== "Left") throw new Error("expected a cooldown");
  expect(result.left).toBeInstanceOf(ChasencarsProviderError);
  expect(findProviderCooldownError(result.left)?.retryAfterMs).toBe(3_600_000);
});
