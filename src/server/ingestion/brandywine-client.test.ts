import { afterEach, expect, test } from "bun:test";
import { Effect, Fiber, TestClock, TestContext } from "effect";
import { fetchBrandywinePage } from "./brandywine-client";
import {
  BRANDYWINE_MAX_RESPONSE_BYTES,
  brandywineRedirect,
} from "./brandywine-html";
import { BRANDYWINE_ROOT, BRANDYWINE_ORIGIN } from "./brandywine-yard-metadata";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});
const gate = <A, E, R>(request: Effect.Effect<A, E, R>) => request;
function mock(responses: (Response | Error)[]) {
  const calls: { url: string; options: RequestInit | undefined }[] = [];
  globalThis.fetch = Object.assign(
    async (input: unknown, options?: RequestInit) => {
      calls.push({ url: String(input), options });
      const response = responses.shift();
      if (!response) throw new Error("Unexpected extra request");
      if (response instanceof Error) throw response;
      return response;
    },
    { preconnect: originalFetch.preconnect },
  );
  return calls;
}
const html = (body = "<html></html>", init: ResponseInit = {}) =>
  new Response(body, {
    ...init,
    headers: { "content-type": "text/html", ...init.headers },
  });

test("follows only the observed anonymous 301 while preserving the literal query", async () => {
  const url = BRANDYWINE_ORIGIN + "/veh_model_breakdown?vehiclename=AUDI+A4";
  const target = brandywineRedirect(url);
  if (!target) throw new Error("Missing expected native redirect");
  const calls = mock([
    html("Moved", { status: 301, headers: { location: target } }),
    html(),
  ]);
  const response = await Effect.runPromise(fetchBrandywinePage(url, gate));
  expect(calls.map((call) => call.url)).toEqual([url, target]);
  expect(response.receipt.finalUrl).toBe(target);
  expect(response.receipt.wires.map((wire) => wire.status)).toEqual([301, 200]);
  expect(calls.every((call) => call.options?.redirect === "manual")).toBe(true);
  expect(calls[0]?.options?.headers).toMatchObject({
    Accept: "text/html",
    "User-Agent": "JunkyardIndex source qualification",
  });
  expect(calls[0]?.options?.headers).not.toHaveProperty("Cookie");
});

test("native zero-byte 301 bodies and ordinary response cookies need no session", async () => {
  const url = BRANDYWINE_ORIGIN + "/veh_single?stockno=08B627";
  const target = brandywineRedirect(url) ?? "";
  const calls = mock([
    new Response(null, {
      status: 301,
      headers: {
        "content-type": "text/html",
        location: target,
        "set-cookie": "ordinary=ignored",
      },
    }),
    html("<html></html>", {
      headers: { "set-cookie": "ordinary=also-ignored" },
    }),
  ]);
  const result = await Effect.runPromise(fetchBrandywinePage(url, gate));
  expect(result.receipt.wires[0]?.body.bytes).toBe(0);
  expect(result.receipt.wires[0]?.body.sha256).toBe(
    "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  );
  expect(calls).toHaveLength(2);
  expect(
    calls.every((call) => !new Headers(call.options?.headers).has("cookie")),
  ).toBe(true);
});

test("the physical request gate includes complete body consumption", async () => {
  let released:
    | ((value: ReadableStreamReadResult<Uint8Array>) => void)
    | undefined;
  let entered = 0,
    finished = 0;
  const response = new Response(
    new ReadableStream<Uint8Array>({
      async pull(controller) {
        const value = await new Promise<ReadableStreamReadResult<Uint8Array>>(
          (resolve) => {
            released = resolve;
          },
        );
        if (value.done) controller.close();
        else {
          controller.enqueue(value.value);
          controller.close();
        }
      },
    }),
    { headers: { "content-type": "text/html" } },
  );
  mock([response]);
  const guarded = <A, E, R>(request: Effect.Effect<A, E, R>) =>
    Effect.sync(() => {
      entered++;
    }).pipe(
      Effect.zipRight(request),
      Effect.ensuring(
        Effect.sync(() => {
          finished++;
        }),
      ),
    );
  const fiber = Effect.runFork(fetchBrandywinePage(BRANDYWINE_ROOT, guarded));
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(entered).toBe(1);
  expect(finished).toBe(0);
  if (!released) throw new Error("Body reader did not start");
  released({ done: false, value: new TextEncoder().encode("<html></html>") });
  await Effect.runPromise(Fiber.join(fiber));
  expect(finished).toBe(1);
});

test("one 25-second deadline includes both redirect gates", async () => {
  const url = BRANDYWINE_ORIGIN + "/veh_single?stockno=08B627";
  const calls = mock([
    new Response(null, {
      status: 301,
      headers: {
        "content-type": "text/html",
        location: brandywineRedirect(url) ?? "",
      },
    }),
    html(),
  ]);
  const delayed = <A, E, R>(request: Effect.Effect<A, E, R>) =>
    Effect.sleep("13 seconds").pipe(Effect.zipRight(request));
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const fiber = yield* fetchBrandywinePage(url, delayed).pipe(
        Effect.either,
        Effect.fork,
      );
      yield* TestClock.adjust("25 seconds");
      return yield* Fiber.join(fiber);
    }).pipe(Effect.provide(TestContext.TestContext)),
  );
  expect(result._tag).toBe("Left");
  expect(calls).toHaveLength(1);
});

test.each<ResponseInit>([
  { status: 403 },
  { status: 429 },
  { status: 206 },
  { status: 302, headers: { location: BRANDYWINE_ROOT } },
  { status: 301, headers: { location: "https://example.com/" } },
  {
    status: 301,
    headers: { location: BRANDYWINE_ORIGIN + "/veh_single/?stockno=OTHER" },
  },
  { headers: { "content-type": "application/json" } },
  { headers: { "content-range": "bytes 0-5/100" } },
  { headers: { "content-length": "1" } },
])(
  "rejects unexpected transport envelopes without retry (%#)",
  async (init) => {
    const calls = mock([html("<html></html>", init)]);
    await expect(
      Effect.runPromise(
        fetchBrandywinePage(
          BRANDYWINE_ORIGIN + "/veh_single?stockno=08B627",
          gate,
        ),
      ),
    ).rejects.toThrow("Prior inventory is preserved");
    expect(calls).toHaveLength(1);
  },
);

test("additional redirects, network failures, oversized bodies and invalid UTF-8 stop the control", async () => {
  const url = BRANDYWINE_ORIGIN + "/veh_single?stockno=08B627";
  const target = brandywineRedirect(url) ?? "";
  const cases = [
    [new TypeError("Network unavailable")],
    [
      html("Moved", { status: 301, headers: { location: target } }),
      html("Moved", { status: 301, headers: { location: target } }),
    ],
    [
      html("Moved", { status: 301, headers: { location: target } }),
      html("x".repeat(BRANDYWINE_MAX_RESPONSE_BYTES)),
    ],
    [
      new Response(new Uint8Array([255]), {
        headers: { "content-type": "text/html" },
      }),
    ],
  ];
  for (const responses of cases) {
    const count = responses.length,
      calls = mock(responses);
    await expect(
      Effect.runPromise(fetchBrandywinePage(url, gate)),
    ).rejects.toThrow("Prior inventory is preserved");
    expect(calls).toHaveLength(count);
  }
});

test("foreign destinations are rejected before the physical request gate", async () => {
  let gated = 0;
  const guarded = <A, E, R>(request: Effect.Effect<A, E, R>) => {
    gated++;
    return request;
  };
  for (const url of [
    "https://example.com/veh_single?stockno=08B627",
    BRANDYWINE_ORIGIN + "/veh_single?stockno=08B627&x=1",
    BRANDYWINE_ORIGIN + "/veh_single?stockno=08B627#x",
    BRANDYWINE_ORIGIN + "/veh_single?stockno=08B627&stockno=08B627",
    BRANDYWINE_ORIGIN + "/wp-json/",
  ])
    await expect(
      Effect.runPromise(fetchBrandywinePage(url, guarded)),
    ).rejects.toThrow("outside the exact published native graph");
  expect(gated).toBe(0);
});
