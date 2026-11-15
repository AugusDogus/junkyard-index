import { afterEach, expect, test } from "bun:test";
import { Clock, Effect, Fiber, TestClock, TestContext } from "effect";
import {
  CHASENCARS_MAX_BODY_BYTES,
  chasencarsRequestGate,
  readChasencarsPage,
} from "./chasencars-client";
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
test("Chase N Cars refuses foreign/detail destinations, denied/challenge/status boundaries, partial bytes and unknown outcomes without retry", async () => {
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
    new Response("unavailable", { status: 503 }),
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
test("Chase N Cars combined body deadline aborts and releases a stalled stream", async () => {
  let canceled = false;
  const response = new Response(
    new ReadableStream<Uint8Array>({
      cancel() {
        canceled = true;
      },
    }),
    { headers: { "content-type": "text/html" } },
  );
  stub(async () => response);
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const fiber = yield* Effect.fork(readChasencarsPage(url, direct));
      yield* TestClock.adjust("20 seconds");
      return yield* Effect.either(Fiber.join(fiber));
    }).pipe(Effect.provide(TestContext.TestContext)),
  );
  expect(result._tag).toBe("Left");
  expect(canceled).toBe(true);
  expect(response.body?.locked).toBe(false);
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
