import { afterEach, expect, test } from "bun:test";
import { Clock, Effect, Fiber, TestClock, TestContext } from "effect";
import {
  CALTON_MAX_BODY_BYTES,
  caltonRequestGate,
  readCaltonPage,
} from "./calton-client";
import type { ProviderRequestGate } from "./provider-http-client";

const originalFetch = globalThis.fetch;
const direct: ProviderRequestGate = (request) => request;
const url = "https://caltonautoparts.com/parts/CHEVROLET/CHEVROLET_PASS.";
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
test("Calton preserves the exact literal dot control and owns one bounded manual GET", async () => {
  const calls: { url: string; options?: RequestInit }[] = [];
  stub(async (url, options) => {
    calls.push({ url, options });
    return new Response("saved", {
      headers: { "content-type": "text/html", "content-length": "5" },
    });
  });
  expect(await Effect.runPromise(readCaltonPage(url, direct))).toBe("saved");
  expect(calls).toHaveLength(1);
  expect(calls[0]?.url).toBe(url);
  expect(calls[0]?.options?.redirect).toBe("manual");
  expect(calls[0]?.options?.signal?.aborted).toBe(true);
});
test("Calton rejects unsupported URLs, response boundaries and incomplete bytes without retry", async () => {
  let calls = 0;
  stub(async () => {
    calls++;
    return new Response("unused");
  });
  for (const target of [
    "https://foreign.example/parts/ACURA",
    url + "?page=2",
    "https://caltonautoparts.com/parts/ACURA/TLX/L11007/2017",
    "https://caltonautoparts.com/inventory/",
  ])
    expect(
      (await Effect.runPromise(Effect.either(readCaltonPage(target, direct))))
        ._tag,
    ).toBe("Left");
  expect(calls).toBe(0);
  for (const response of [
    new Response("redirect", { status: 301 }),
    new Response("partial", { status: 206 }),
    new Response("{}", { headers: { "content-type": "application/json" } }),
    new Response("short", {
      headers: { "content-type": "text/html", "content-length": "100" },
    }),
    new Response("x".repeat(CALTON_MAX_BODY_BYTES + 1), {
      headers: { "content-type": "text/html" },
    }),
  ]) {
    calls = 0;
    stub(async () => {
      calls++;
      return response;
    });
    expect(
      (await Effect.runPromise(Effect.either(readCaltonPage(url, direct))))
        ._tag,
    ).toBe("Left");
    expect(calls).toBe(1);
    expect(response.body?.locked).toBe(false);
  }
});
test("Calton interruption aborts a stalled body and releases its reader", async () => {
  let canceled = false,
    calls = 0;
  const response = new Response(
    new ReadableStream<Uint8Array>({
      cancel() {
        canceled = true;
      },
    }),
    { headers: { "content-type": "text/html" } },
  );
  stub(async () => {
    calls++;
    return response;
  });
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const fiber = yield* Effect.fork(readCaltonPage(url, direct));
      yield* TestClock.adjust("20 seconds");
      return yield* Effect.either(Fiber.join(fiber));
    }).pipe(Effect.provide(TestContext.TestContext)),
  );
  expect(result._tag).toBe("Left");
  expect(calls).toBe(1);
  expect(canceled).toBe(true);
  expect(response.body?.locked).toBe(false);
});
test("Calton shared request gate serializes callers with a 1.6-second gap", async () => {
  const starts: number[] = [];
  await Effect.runPromise(
    Effect.gen(function* () {
      const request = caltonRequestGate(
        Effect.gen(function* () {
          starts.push(yield* Clock.currentTimeMillis);
        }),
      );
      const first = yield* Effect.fork(request);
      const second = yield* Effect.fork(request);
      yield* TestClock.adjust("3200 millis");
      yield* Fiber.join(first);
      yield* Fiber.join(second);
    }).pipe(Effect.provide(TestContext.TestContext)),
  );
  expect(starts).toHaveLength(2);
  expect((starts[1] ?? 0) - (starts[0] ?? 0)).toBe(1600);
});
