import { afterEach, expect, test } from "bun:test";
import { Clock, Effect, Fiber, TestClock, TestContext } from "effect";
import {
  BEAVERS_MAX_RESPONSE_BYTES,
  beaversRequestGate,
  fetchBeaversPage,
} from "./beavers-client";
import { BEAVERS_CATALOG, beaversDetailUrl } from "./beavers-yard-metadata";
import { beaversTestRecord } from "./beavers-test-fixtures";

const originalFetch = globalThis.fetch;
const direct = <A, E, R>(request: Effect.Effect<A, E, R>) => request;
afterEach(() => {
  globalThis.fetch = originalFetch;
});
function stub(run: (url: string, options?: RequestInit) => Promise<Response>) {
  globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL, options?: RequestInit) =>
      run(input instanceof Request ? input.url : String(input), options),
    { preconnect: originalFetch.preconnect },
  );
}
test("client follows only the actual matching native 302 in a separate manual GET", async () => {
  const route = beaversTestRecord(0).row.url;
  const requests: string[] = [];
  stub(async (url, options) => {
    requests.push(url);
    expect(options?.redirect).toBe("manual");
    expect(options?.method).toBe("GET");
    return new Response("redirect", {
      status: 302,
      headers: {
        "content-type": "text/html",
        location: new URL(beaversDetailUrl(route)).pathname,
      },
    });
  });
  expect(await Effect.runPromise(fetchBeaversPage(route, direct))).toEqual({
    kind: "redirect",
    url: beaversDetailUrl(route),
  });
  expect(requests).toEqual([route]);
});
test("unsupported destinations do not request; foreign and malformed redirects fail once", async () => {
  let calls = 0;
  stub(async () => {
    calls++;
    return new Response("unused");
  });
  for (const url of [
    "https://foreign.example/",
    BEAVERS_CATALOG + "?page=0",
    beaversTestRecord(0).url.replace("/503/", "/504/"),
    BEAVERS_CATALOG + "#fragment",
  ])
    expect(
      (await Effect.runPromise(Effect.either(fetchBeaversPage(url, direct))))
        ._tag,
    ).toBe("Left");
  expect(calls).toBe(0);
  for (const location of [
    "https://foreign.example/VehiclePartSearch/503/10000000",
    "/VehiclePartSearch/503/10000001",
    "http://[",
  ]) {
    calls = 0;
    stub(async () => {
      calls++;
      return new Response("redirect", {
        status: 302,
        headers: { "content-type": "text/html", location },
      });
    });
    await expect(
      Effect.runPromise(fetchBeaversPage(beaversTestRecord(0).row.url, direct)),
    ).rejects.toThrow("tenant 503");
    expect(calls).toBe(1);
  }
});
test("denials, challenges, partial bodies, MIME drift and oversize fail without retry", async () => {
  for (const response of [
    new Response("Access Denied", {
      status: 403,
      headers: { "content-type": "text/html" },
    }),
    new Response("challenge", {
      status: 429,
      headers: { "content-type": "text/html", "retry-after": "1" },
    }),
    new Response("partial", {
      status: 206,
      headers: { "content-type": "text/html" },
    }),
    new Response("{}", { headers: { "content-type": "application/json" } }),
    new Response("partial", {
      headers: {
        "content-type": "text/html",
        "content-range": "bytes 0-7/100",
      },
    }),
    new Response("short", {
      headers: { "content-type": "text/html", "content-length": "100" },
    }),
    new Response("x".repeat(BEAVERS_MAX_RESPONSE_BYTES + 1), {
      headers: { "content-type": "text/html" },
    }),
  ]) {
    let calls = 0;
    stub(async () => {
      calls++;
      return response;
    });
    await expect(
      Effect.runPromise(fetchBeaversPage(BEAVERS_CATALOG, direct)),
    ).rejects.toThrow("Previous inventory");
    expect(calls).toBe(1);
    expect(response.body?.locked).toBe(false);
  }
});
test("wrong resolved origins and unknown network failures stop without retry", async () => {
  for (const network of [false, true]) {
    let calls = 0;
    stub(async () => {
      calls++;
      if (network) throw new TypeError("Connection interrupted");
      const response = new Response("html", {
        headers: { "content-type": "text/html" },
      });
      Object.defineProperty(response, "url", {
        value: "https://foreign.example/",
      });
      return response;
    });
    await expect(
      Effect.runPromise(fetchBeaversPage(BEAVERS_CATALOG, direct)),
    ).rejects.toThrow("Previous inventory");
    expect(calls).toBe(1);
  }
});
test("combined request/body deadline cancels a stalled reader and releases its lock", async () => {
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
      const fiber = yield* Effect.fork(
        fetchBeaversPage(BEAVERS_CATALOG, direct),
      );
      yield* TestClock.adjust("25 seconds");
      return yield* Effect.either(Fiber.join(fiber));
    }).pipe(Effect.provide(TestContext.TestContext)),
  );
  expect(result._tag).toBe("Left");
  expect(canceled).toBe(true);
  expect(response.body?.locked).toBe(false);
});
test("native request gate serializes callers with a 1.6 second gap", async () => {
  const starts: number[] = [];
  await Effect.runPromise(
    Effect.gen(function* () {
      const request = beaversRequestGate(
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
