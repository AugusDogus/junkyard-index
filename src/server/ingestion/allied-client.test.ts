import { afterEach, expect, test } from "bun:test";
import { Clock, Effect, Fiber, TestClock, TestContext } from "effect";
import type { ProviderRequestGate } from "./provider-http-client";
import {
  ALLIED_MAX_BODY_BYTES,
  alliedRequestGate,
  readAlliedPage,
} from "./allied-client";
import { ALLIED_ORIGIN } from "./allied-html";

const originalFetch = globalThis.fetch;
const direct: ProviderRequestGate = (request) => request;
const url = ALLIED_ORIGIN + "/parts/LEXUS/LEXUS_LS460/";
afterEach(() => {
  globalThis.fetch = originalFetch;
});
function stub(
  run: (url: string, options: RequestInit | undefined) => Promise<Response>,
) {
  globalThis.fetch = Object.assign(
    async (input: string | URL | Request, options?: RequestInit) =>
      run(input instanceof Request ? input.url : String(input), options),
    { preconnect: originalFetch.preconnect },
  );
}
test("Allied adapter owns one GET with manual redirects, HTML acceptance and a request/body abort signal", async () => {
  const calls: { url: string; options: RequestInit | undefined }[] = [];
  stub(async (requestUrl, options) => {
    calls.push({ url: requestUrl, options });
    return new Response("complete", {
      headers: {
        "content-type": "text/html; charset=UTF-8",
        "content-length": "8",
      },
    });
  });
  expect(await Effect.runPromise(readAlliedPage(url, direct))).toBe("complete");
  expect(calls).toHaveLength(1);
  expect(calls[0]?.options?.method).toBe("GET");
  expect(calls[0]?.options?.redirect).toBe("manual");
  expect(calls[0]?.options?.signal?.aborted).toBe(true);
});
test("Allied adapter rejects unowned destinations before dispatch", async () => {
  let calls = 0;
  stub(async () => {
    calls++;
    return new Response("should not dispatch");
  });
  for (const target of [
    "https://foreign.example/parts/LEXUS/LS460/",
    url + "?page=2",
    ALLIED_ORIGIN + "/parts/LEXUS/LEXUS_LS460/J60711/2012",
  ]) {
    const result = await Effect.runPromise(
      Effect.either(readAlliedPage(target, direct)),
    );
    expect(result._tag).toBe("Left");
  }
  expect(calls).toBe(0);
});
test("Allied adapter rejects redirects, partial bodies, foreign final URLs and wrong MIME without retry", async () => {
  const responses = [
    new Response("redirect", { status: 302 }),
    new Response("partial", { status: 206 }),
    new Response("partial", {
      headers: { "content-type": "text/html", "content-range": "bytes 0-6/10" },
    }),
    new Response("{}", { headers: { "content-type": "application/json" } }),
    new Response("foreign", { headers: { "content-type": "text/html" } }),
  ];
  Object.defineProperty(responses[4], "url", {
    value: "https://foreign.example/",
  });
  for (const response of responses) {
    let calls = 0;
    stub(async () => {
      calls++;
      return response;
    });
    const result = await Effect.runPromise(
      Effect.either(readAlliedPage(url, direct)),
    );
    expect(result._tag).toBe("Left");
    expect(calls).toBe(1);
    expect(response.body?.locked).toBe(false);
  }
});
test("Allied adapter enforces exact body completion and its 2 MiB streaming cap", async () => {
  for (const response of [
    new Response("short", {
      headers: { "content-type": "text/html", "content-length": "100" },
    }),
    new Response("x".repeat(ALLIED_MAX_BODY_BYTES + 1), {
      headers: { "content-type": "text/html" },
    }),
  ]) {
    stub(async () => response);
    const result = await Effect.runPromise(
      Effect.either(readAlliedPage(url, direct)),
    );
    expect(result._tag).toBe("Left");
    expect(response.body?.locked).toBe(false);
  }
});
test("Allied request/body timeout aborts the one in-flight request and performs no retry", async () => {
  let calls = 0,
    aborted = false;
  stub(async (_url, options) => {
    calls++;
    return new Promise<Response>((_resolve, reject) => {
      const signal = options?.signal;
      if (!signal) {
        reject(new Error("Missing abort signal"));
        return;
      }
      signal.addEventListener(
        "abort",
        () => {
          aborted = true;
          reject(signal.reason);
        },
        { once: true },
      );
    });
  });
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const fiber = yield* Effect.fork(readAlliedPage(url, direct));
      yield* TestClock.adjust("45 seconds");
      return yield* Effect.either(Fiber.join(fiber));
    }).pipe(Effect.provide(TestContext.TestContext)),
  );
  expect(result._tag).toBe("Left");
  expect(calls).toBe(1);
  expect(aborted).toBe(true);
});
test("Allied body shares the request deadline and releases a stalled response reader", async () => {
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
      const fiber = yield* Effect.fork(readAlliedPage(url, direct));
      yield* TestClock.adjust("45 seconds");
      return yield* Effect.either(Fiber.join(fiber));
    }).pipe(Effect.provide(TestContext.TestContext)),
  );
  expect(result._tag).toBe("Left");
  expect(calls).toBe(1);
  expect(canceled).toBe(true);
  expect(response.body?.locked).toBe(false);
});
test("Allied shared request gate serializes callers and preserves the two-second gap", async () => {
  const starts: number[] = [];
  await Effect.runPromise(
    Effect.gen(function* () {
      const request = alliedRequestGate(
        Effect.gen(function* () {
          starts.push(yield* Clock.currentTimeMillis);
        }),
      );
      const first = yield* Effect.fork(request);
      const second = yield* Effect.fork(request);
      yield* TestClock.adjust("4000 millis");
      yield* Fiber.join(first);
      yield* Fiber.join(second);
    }).pipe(Effect.provide(TestContext.TestContext)),
  );
  expect(starts).toHaveLength(2);
  expect((starts[1] ?? 0) - (starts[0] ?? 0)).toBe(2000);
});

test("Allied escapes parentheses in published browse paths without changing the native route", async () => {
  const calls: string[] = [];
  stub(async (target) => {
    calls.push(target);
    return new Response("complete", {
      headers: { "content-type": "text/html" },
    });
  });
  const native = ALLIED_ORIGIN + "/parts/CHRYSLER/NEW_YORKER_(FWD)/";
  expect(await Effect.runPromise(readAlliedPage(native, direct))).toBe(
    "complete",
  );
  expect(calls).toEqual([
    ALLIED_ORIGIN + "/parts/CHRYSLER/NEW_YORKER_%28FWD%29/",
  ]);
});
