import { afterEach, expect, test } from "bun:test";
import { Clock, Effect, Either, Fiber, TestClock, TestContext } from "effect";
import type { ProviderRequestGate } from "./provider-http-client";
import {
  PRATT_MAX_BODY_BYTES,
  PRATT_REQUEST_ATTEMPTS,
  prattRequestGate,
  readPrattPage,
} from "./pratt-client";
import { PRATT_ORIGIN } from "./pratt-html";
import {
  ProviderChunkClock,
  ProviderTurnDeferred,
} from "./provider-chunk-clock";

const originalFetch = globalThis.fetch;
const direct: ProviderRequestGate = (request) => request;
const url = PRATT_ORIGIN + "/parts/LEXUS/LEXUS_LS460/";
afterEach(() => {
  globalThis.fetch = originalFetch;
});
/** Runs `effect` on the test clock in 1-second steps, letting resolved
 * promises settle before time moves on. `tick` sees each new clock time
 * before the fibers it wakes run. */
function onTestClock<A, E>(
  effect: Effect.Effect<A, E>,
  tick: (ms: number) => void = () => undefined,
) {
  return Effect.runPromise(
    Effect.gen(function* () {
      const fiber = yield* Effect.fork(Effect.either(effect));
      while (fiber.unsafePoll() === null) {
        yield* Effect.promise(
          () => new Promise<void>((resolve) => setImmediate(resolve)),
        );
        tick((yield* Clock.currentTimeMillis) + 1000);
        yield* TestClock.adjust("1 second");
      }
      return yield* Fiber.join(fiber);
    }).pipe(Effect.provide(TestContext.TestContext)),
  );
}
function stub(
  run: (url: string, options: RequestInit | undefined) => Promise<Response>,
) {
  globalThis.fetch = Object.assign(
    async (input: string | URL | Request, options?: RequestInit) =>
      run(input instanceof Request ? input.url : String(input), options),
    { preconnect: originalFetch.preconnect },
  );
}
test("Pratt adapter owns one GET with manual redirects, HTML acceptance and a request/body abort signal", async () => {
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
  expect(await Effect.runPromise(readPrattPage(url, direct))).toBe("complete");
  expect(calls).toHaveLength(1);
  expect(calls[0]?.options?.method).toBe("GET");
  expect(calls[0]?.options?.redirect).toBe("manual");
  expect(calls[0]?.options?.signal?.aborted).toBe(true);
});
test("Pratt adapter dispatches raw-ampersand model routes unchanged", async () => {
  const calls: string[] = [];
  stub(async (requestUrl) => {
    calls.push(requestUrl);
    return new Response("complete", {
      headers: { "content-type": "text/html" },
    });
  });
  const routes = [
    PRATT_ORIGIN + "/parts/CHRYSLER/TOWN_&_COUNTRY/",
    PRATT_ORIGIN + "/parts/LINCOLN/LINCOLN_&_TOWN_CAR/",
  ];
  for (const route of routes)
    expect(await Effect.runPromise(readPrattPage(route, direct))).toBe(
      "complete",
    );
  expect(calls).toEqual(routes);
});
test("Pratt adapter rejects unowned destinations before dispatch", async () => {
  let calls = 0;
  stub(async () => {
    calls++;
    return new Response("should not dispatch");
  });
  for (const target of [
    "https://foreign.example/parts/LEXUS/LS460/",
    url + "?page=2",
    PRATT_ORIGIN + "/parts/LEXUS/LEXUS_LS460/J60711/2012",
  ]) {
    const result = await Effect.runPromise(
      Effect.either(readPrattPage(target, direct)),
    );
    expect(result._tag).toBe("Left");
  }
  expect(calls).toBe(0);
});
test("Pratt adapter rejects redirects, partial bodies, foreign final URLs and wrong MIME without retry", async () => {
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
      Effect.either(readPrattPage(url, direct)),
    );
    expect(result._tag).toBe("Left");
    expect(calls).toBe(1);
    expect(response.body?.locked).toBe(false);
  }
});
test("Pratt adapter enforces exact body completion and its 2 MiB streaming cap", async () => {
  for (const response of [
    new Response("short", {
      headers: { "content-type": "text/html", "content-length": "100" },
    }),
    new Response("x".repeat(PRATT_MAX_BODY_BYTES + 1), {
      headers: { "content-type": "text/html" },
    }),
  ]) {
    stub(async () => response);
    const result = await Effect.runPromise(
      Effect.either(readPrattPage(url, direct)),
    );
    expect(result._tag).toBe("Left");
    expect(response.body?.locked).toBe(false);
  }
});
test("Pratt request/body timeout aborts each in-flight attempt and fails after three attempts", async () => {
  let calls = 0,
    aborted = 0;
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
          aborted++;
          reject(signal.reason);
        },
        { once: true },
      );
    });
  });
  const result = await onTestClock(readPrattPage(url, direct));
  expect(result._tag).toBe("Left");
  if (result._tag === "Left")
    expect(result.left.message).toContain("deadline exceeded 20 seconds");
  expect(calls).toBe(PRATT_REQUEST_ATTEMPTS);
  expect(aborted).toBe(PRATT_REQUEST_ATTEMPTS);
});
test("Pratt body shares the request deadline and releases each stalled response reader", async () => {
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
  const result = await onTestClock(readPrattPage(url, direct));
  expect(result._tag).toBe("Left");
  expect(responses).toHaveLength(PRATT_REQUEST_ATTEMPTS);
  expect(canceled).toBe(PRATT_REQUEST_ATTEMPTS);
  expect(responses.every((response) => !response.body?.locked)).toBe(true);
});
test("Pratt retries HTTP 5xx and failed fetches, 5 then 10 seconds apart, and accepts the next complete page", async () => {
  const sent: number[] = [];
  let now = 0;
  const answers = [
    () => new Response("busy", { status: 500 }),
    () => {
      throw new TypeError("fetch failed");
    },
    () =>
      new Response("complete", { headers: { "content-type": "text/html" } }),
  ];
  stub(async () => {
    const answer = answers[sent.length];
    sent.push(now);
    if (!answer) throw new Error("Unexpected extra attempt");
    return answer();
  });
  const result = await onTestClock(readPrattPage(url, direct), (ms) => {
    now = ms;
  });
  expect(result).toEqual(Either.right("complete"));
  expect(sent).toEqual([0, 5_000, 15_000]);
});
test("Pratt retries a connection the server drops mid-body", async () => {
  // undici reports a reset after the headers as `TypeError: terminated`.
  let calls = 0;
  stub(async () => {
    calls++;
    return calls === 1
      ? new Response(
          new ReadableStream<Uint8Array>({
            pull(controller) {
              controller.error(new TypeError("terminated"));
            },
          }),
          { headers: { "content-type": "text/html" } },
        )
      : new Response("complete", { headers: { "content-type": "text/html" } });
  });
  const result = await onTestClock(readPrattPage(url, direct));
  expect(result).toEqual(Either.right("complete"));
  expect(calls).toBe(2);
});
test("Pratt fails after three transient attempts", async () => {
  let calls = 0;
  stub(async () => {
    calls++;
    return new Response("unavailable", { status: 503 });
  });
  const result = await onTestClock(readPrattPage(url, direct));
  expect(result._tag).toBe("Left");
  if (result._tag === "Left") {
    expect(result.left.message).toContain("received HTTP503");
  }
  expect(calls).toBe(PRATT_REQUEST_ATTEMPTS);
});
test("Pratt fails closed on client errors without retry", async () => {
  for (const status of [400, 403, 404, 429]) {
    let calls = 0;
    const response = new Response("refused", { status });
    stub(async () => {
      calls++;
      return response;
    });
    const result = await onTestClock(readPrattPage(url, direct));
    expect(result._tag).toBe("Left");
    if (result._tag === "Left")
      expect(result.left.message).toContain("received HTTP" + status);
    expect(calls).toBe(1);
    expect(response.body?.locked).toBe(false);
  }
});
test("Pratt sends no attempt that could outlast the chunk's work deadline", async () => {
  let calls = 0;
  stub(async () => {
    calls++;
    return new Response("complete", {
      headers: { "content-type": "text/html" },
    });
  });
  const result = await onTestClock(
    Effect.sleep("155 seconds").pipe(
      Effect.andThen(readPrattPage(url, direct)),
      ProviderChunkClock.deadline({
        duration: "3 minutes",
        onTimeout: () => new Error("work deadline"),
      }),
    ),
  );
  expect(Either.isLeft(result) && result.left).toBeInstanceOf(
    ProviderTurnDeferred,
  );
  expect(calls).toBe(0);
});
test("Pratt shared request gate serializes callers and preserves the 1.6-second gap", async () => {
  const starts: number[] = [];
  await Effect.runPromise(
    Effect.gen(function* () {
      const request = prattRequestGate(
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
