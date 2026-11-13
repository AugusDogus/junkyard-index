import { afterEach, expect, test } from "bun:test";
import { Clock, Effect, Fiber, TestClock, TestContext } from "effect";
import type { ProviderRequestGate } from "./provider-http-client";
import {
  rmmdtpRequestGate,
  readRmmdtpPage,
  rmmdtpRequestUrl,
} from "./rmmdtp-client";
import { RMMDTP_ORIGIN, RMMDTP_MAX_BODY_BYTES } from "./rmmdtp-html";

const originalFetch = globalThis.fetch;
const direct: ProviderRequestGate = (request) => request;
const url = RMMDTP_ORIGIN + "/trucks/";
afterEach(() => {
  globalThis.fetch = originalFetch;
});
test("RMMDTP allows only the exact owned unfiltered native graph", () => {
  expect(rmmdtpRequestUrl(url)).toBe(true);
  expect(rmmdtpRequestUrl(url + "?page_number=5")).toBe(true);
  for (const target of [
    "https://foreign.example/trucks/",
    url + "?page_number=1",
    url + "?page_number=401",
    url + "?page_number=2&f-condition=nw",
    url + "?page_number=2&page_number=2",
    url + "?page_number=02",
    url + "?f-condition=nw",
    url + "#fragment",
    url + "?page_number=2&",
    RMMDTP_ORIGIN + "/trucks",
    RMMDTP_ORIGIN + "/truck-description/?truck=196423",
  ])
    expect(rmmdtpRequestUrl(target)).toBe(false);
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
test("RMMDTP adapter owns one GET with manual redirects, HTML acceptance and a request/body abort signal", async () => {
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
  expect(await Effect.runPromise(readRmmdtpPage(url, direct))).toBe("complete");
  expect(calls).toHaveLength(1);
  expect(calls[0]?.options?.method).toBe("GET");
  expect(calls[0]?.options?.redirect).toBe("manual");
  expect(calls[0]?.options?.signal?.aborted).toBe(true);
});
test("RMMDTP adapter rejects unowned destinations before dispatch", async () => {
  let calls = 0;
  stub(async () => {
    calls++;
    return new Response("should not dispatch");
  });
  for (const target of [
    "https://foreign.example/trucks/",
    url + "?page=2",
    RMMDTP_ORIGIN + "/trucks/attachment/",
  ]) {
    const result = await Effect.runPromise(
      Effect.either(readRmmdtpPage(target, direct)),
    );
    expect(result._tag).toBe("Left");
  }
  expect(calls).toBe(0);
});
test("RMMDTP adapter rejects redirects, partial bodies, foreign final URLs and wrong MIME without retry", async () => {
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
      Effect.either(readRmmdtpPage(url, direct)),
    );
    expect(result._tag).toBe("Left");
    expect(calls).toBe(1);
    expect(response.body?.locked).toBe(false);
  }
});
test("RMMDTP adapter enforces exact body completion and its 2 MiB streaming cap", async () => {
  for (const response of [
    new Response("short", {
      headers: { "content-type": "text/html", "content-length": "100" },
    }),
    new Response("x".repeat(RMMDTP_MAX_BODY_BYTES + 1), {
      headers: { "content-type": "text/html" },
    }),
  ]) {
    stub(async () => response);
    const result = await Effect.runPromise(
      Effect.either(readRmmdtpPage(url, direct)),
    );
    expect(result._tag).toBe("Left");
    expect(response.body?.locked).toBe(false);
  }
});
test("RMMDTP request/body timeout aborts the one in-flight request and performs no retry", async () => {
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
      const fiber = yield* Effect.fork(readRmmdtpPage(url, direct));
      yield* TestClock.adjust("20 seconds");
      return yield* Effect.either(Fiber.join(fiber));
    }).pipe(Effect.provide(TestContext.TestContext)),
  );
  expect(result._tag).toBe("Left");
  expect(calls).toBe(1);
  expect(aborted).toBe(true);
});
test("RMMDTP body shares the request deadline and releases a stalled response reader", async () => {
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
      const fiber = yield* Effect.fork(readRmmdtpPage(url, direct));
      yield* TestClock.adjust("20 seconds");
      return yield* Effect.either(Fiber.join(fiber));
    }).pipe(Effect.provide(TestContext.TestContext)),
  );
  expect(result._tag).toBe("Left");
  expect(calls).toBe(1);
  expect(canceled).toBe(true);
  expect(response.body?.locked).toBe(false);
});
test("RMMDTP shared request gate serializes callers and preserves the 1.6-second gap", async () => {
  const starts: number[] = [];
  await Effect.runPromise(
    Effect.gen(function* () {
      const request = rmmdtpRequestGate(
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
