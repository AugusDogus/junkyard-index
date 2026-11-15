import { afterEach, expect, test } from "bun:test";
import { Clock, Effect, Fiber, TestClock, TestContext } from "effect";
import type { ProviderRequestGate } from "./provider-http-client";
import {
  BYOT_MAX_BODY_BYTES,
  byotRequestGate,
  readByotPage,
} from "./byot-client";
import { BYOT_ARRIVALS_URL } from "./byot-directory";

const originalFetch = globalThis.fetch;
const direct: ProviderRequestGate = (request) => request;
const url = BYOT_ARRIVALS_URL;
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
test("BYOT adapter owns one GET with manual redirects, JSON acceptance and a request/body abort signal", async () => {
  const calls: { url: string; options: RequestInit | undefined }[] = [];
  stub(async (requestUrl, options) => {
    calls.push({ url: requestUrl, options });
    return new Response("complete", {
      headers: {
        "content-type": "application/json; charset=UTF-8",
        "content-length": "8",
      },
    });
  });
  expect(await Effect.runPromise(readByotPage(url, "1123", direct))).toBe(
    "complete",
  );
  expect(calls).toHaveLength(1);
  expect(calls[0]?.options?.method).toBe("GET");
  expect(new Headers(calls[0]?.options?.headers).get("Location")).toBe("1123");
  expect(calls[0]?.options?.redirect).toBe("manual");
  expect(calls[0]?.options?.signal?.aborted).toBe(true);
});
test("BYOT adapter rejects unowned destinations before dispatch", async () => {
  let calls = 0;
  stub(async () => {
    calls++;
    return new Response("should not dispatch");
  });
  for (const target of [
    "https://foreign.example/parts/LEXUS/LS460/",
    url + "?page=2",
    "https://api.byotautoparts.com/search/vehicles?location=9999",
  ]) {
    const result = await Effect.runPromise(
      Effect.either(readByotPage(target, "1123", direct)),
    );
    expect(result._tag).toBe("Left");
  }
  expect(calls).toBe(0);
});
test("BYOT adapter rejects redirects, partial bodies, foreign final URLs and wrong MIME without retry", async () => {
  const responses = [
    new Response("redirect", { status: 302 }),
    new Response("partial", { status: 206 }),
    new Response("partial", {
      headers: {
        "content-type": "application/json",
        "content-range": "bytes 0-6/10",
      },
    }),
    new Response("<html>", { headers: { "content-type": "text/html" } }),
    new Response("foreign", {
      headers: { "content-type": "application/json" },
    }),
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
      Effect.either(readByotPage(url, "1123", direct)),
    );
    expect(result._tag).toBe("Left");
    expect(calls).toBe(1);
    expect(response.body?.locked).toBe(false);
  }
});
test("BYOT adapter enforces exact body completion and its 2 MiB streaming cap", async () => {
  for (const response of [
    new Response("short", {
      headers: { "content-type": "application/json", "content-length": "100" },
    }),
    new Response("x".repeat(BYOT_MAX_BODY_BYTES + 1), {
      headers: { "content-type": "application/json" },
    }),
  ]) {
    stub(async () => response);
    const result = await Effect.runPromise(
      Effect.either(readByotPage(url, "1123", direct)),
    );
    expect(result._tag).toBe("Left");
    expect(response.body?.locked).toBe(false);
  }
});
test("BYOT request/body timeout aborts the one in-flight request and performs no retry", async () => {
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
      const fiber = yield* Effect.fork(readByotPage(url, "1123", direct));
      yield* TestClock.adjust("45 seconds");
      return yield* Effect.either(Fiber.join(fiber));
    }).pipe(Effect.provide(TestContext.TestContext)),
  );
  expect(result._tag).toBe("Left");
  expect(calls).toBe(1);
  expect(aborted).toBe(true);
});
test("BYOT body shares the request deadline and releases a stalled response reader", async () => {
  let canceled = false,
    calls = 0;
  const response = new Response(
    new ReadableStream<Uint8Array>({
      cancel() {
        canceled = true;
      },
    }),
    { headers: { "content-type": "application/json" } },
  );
  stub(async () => {
    calls++;
    return response;
  });
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const fiber = yield* Effect.fork(readByotPage(url, "1123", direct));
      yield* TestClock.adjust("45 seconds");
      return yield* Effect.either(Fiber.join(fiber));
    }).pipe(Effect.provide(TestContext.TestContext)),
  );
  expect(result._tag).toBe("Left");
  expect(calls).toBe(1);
  expect(canceled).toBe(true);
  expect(response.body?.locked).toBe(false);
});
test("BYOT shared request gate serializes callers and preserves the two-second gap", async () => {
  const starts: number[] = [];
  await Effect.runPromise(
    Effect.gen(function* () {
      const request = byotRequestGate(
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

test("BYOT rejects mismatched location controls and reports Retry-After without retrying", async () => {
  let calls = 0;
  stub(async () => {
    calls++;
    return new Response("rate limited", {
      status: 429,
      headers: { "Retry-After": "120", "content-type": "text/html" },
    });
  });
  const wrongYard = await Effect.runPromise(
    Effect.either(readByotPage(url, "9999", direct)),
  );
  expect(wrongYard._tag).toBe("Left");
  expect(calls).toBe(0);
  const rateLimit = await Effect.runPromise(
    Effect.either(readByotPage(url, "1123", direct)),
  );
  expect(rateLimit._tag).toBe("Left");
  if (rateLimit._tag === "Left")
    expect(rateLimit.left.message).toContain("Retry-After: 120");
  expect(calls).toBe(1);
});
