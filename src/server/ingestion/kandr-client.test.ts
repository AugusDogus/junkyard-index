import { afterEach, expect, test } from "bun:test";
import { Clock, Effect, Fiber, TestClock, TestContext } from "effect";
import { kandrRequestGate, readKandrPage } from "./kandr-client";
import { streamKandrInventory } from "./kandr-connector";
import { KandrCursor } from "./kandr-cursor";
import { KANDR_CONTROLS, KANDR_MAX_BODY_BYTES } from "./kandr-native";
import { kandrFixture } from "./kandr-test-fixtures";
import { findProviderCooldownError } from "./transient-request";

const original = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = original;
});
const gate = <A, E, R>(request: Effect.Effect<A, E, R>) => request;
test("K&R cancels denials, challenges, redirects and invalid bodies without retry", async () => {
  const responses = [
    new Response("denied", { status: 403 }),
    new Response("limited", { status: 429, headers: { "retry-after": "300" } }),
    new Response("challenge", {
      headers: { "content-type": "text/html", "cf-mitigated": "challenge" },
    }),
    new Response("moved", {
      status: 302,
      headers: { location: "https://example.com/" },
    }),
    new Response("partial", {
      headers: { "content-type": "text/html", "content-range": "bytes 0-7/99" },
    }),
    new Response("short", {
      headers: { "content-type": "text/html", "content-length": "100" },
    }),
    new Response(new Uint8Array([255]), {
      headers: { "content-type": "text/html" },
    }),
    new Response("x".repeat(KANDR_MAX_BODY_BYTES + 1), {
      headers: { "content-type": "text/html" },
    }),
  ];
  for (const response of responses) {
    let requests = 0;
    globalThis.fetch = Object.assign(
      async () => {
        requests++;
        return response;
      },
      { preconnect: original.preconnect },
    );
    await expect(
      Effect.runPromise(readKandrPage(KANDR_CONTROLS, gate)),
    ).rejects.toThrow("Prior inventory is preserved");
    expect(requests).toBe(1);
    expect(response.body?.locked).toBe(false);
  }
});
test("K&R rejects retail, foreign, filtered and vendor-host destinations before HTTP", async () => {
  let requests = 0;
  globalThis.fetch = Object.assign(
    async () => {
      requests++;
      return new Response("unexpected");
    },
    { preconnect: original.preconnect },
  );
  const listing = kandrFixture.opening[0]?.url;
  if (!listing) throw new Error("Missing actual listing URL");
  for (const url of [
    listing.replace("99994", "99993"),
    listing.replace("keywords=", "keywords=volvo"),
    listing.replace("kandrtruckparts.com", "example.com"),
    "https://imagehost.heavytruckparts.net/",
    "https://kandrtruckparts.com/wp-json/",
    KANDR_CONTROLS + "?all=1",
  ])
    await expect(Effect.runPromise(readKandrPage(url, gate))).rejects.toThrow();
  expect(requests).toBe(0);
});
test("K&R interruption aborts transport and settles the full-body reader", async () => {
  let announce = () => {};
  const fetched = new Promise<void>((resolve) => {
    announce = resolve;
  });
  let cancelled = false;
  let signal: AbortSignal | null = null;
  const body = new ReadableStream<Uint8Array>({
    cancel() {
      cancelled = true;
    },
  });
  globalThis.fetch = Object.assign(
    async (_input: string | URL | Request, init?: RequestInit) => {
      signal = init?.signal ?? null;
      announce();
      return new Response(body, { headers: { "content-type": "text/html" } });
    },
    { preconnect: original.preconnect },
  );
  const fiber = Effect.runFork(readKandrPage(KANDR_CONTROLS, gate));
  await fetched;
  await Effect.runPromise(Fiber.interrupt(fiber));
  expect(signal).toMatchObject({ aborted: true });
  expect(cancelled).toBe(true);
  expect(body.locked).toBe(false);
});

test("K&R body deadline cancels each stalled reader and retries it twice", async () => {
  const responses: Response[] = [];
  let cancelled = 0;
  globalThis.fetch = Object.assign(
    async () => {
      const response = new Response(
        new ReadableStream<Uint8Array>({
          cancel() {
            cancelled++;
          },
        }),
        { headers: { "content-type": "text/html" } },
      );
      responses.push(response);
      return response;
    },
    { preconnect: original.preconnect },
  );
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const fiber = yield* Effect.fork(readKandrPage(KANDR_CONTROLS, gate));
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
      tag: "KandrError",
      message: expect.stringContaining(
        "Combined request and body deadline exceeded 20 seconds",
      ),
    },
  });
  expect(responses).toHaveLength(3);
  expect(cancelled).toBe(3);
  expect(responses.every((response) => !response.body?.locked)).toBe(true);
});

test("K&R retries a 502 and a dropped connection, then reads the page", async () => {
  const outcomes: (() => Response)[] = [
    () => new Response("bad gateway", { status: 502 }),
    () => {
      throw new TypeError("fetch failed");
    },
    () =>
      new Response("<html>controls</html>", {
        headers: { "content-type": "text/html" },
      }),
  ];
  let calls = 0;
  globalThis.fetch = Object.assign(
    async () => {
      const next = outcomes[calls++];
      if (!next) throw new Error("unexpected extra request");
      return next();
    },
    { preconnect: original.preconnect },
  );
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const fiber = yield* Effect.fork(readKandrPage(KANDR_CONTROLS, gate));
      for (const step of ["2 seconds", "4 seconds"] as const) {
        yield* Effect.promise(
          () => new Promise((resolve) => setTimeout(resolve, 5)),
        );
        yield* TestClock.adjust(step);
      }
      return yield* Fiber.join(fiber);
    }).pipe(Effect.provide(TestContext.TestContext)),
  );
  expect(result).toBe("<html>controls</html>");
  expect(calls).toBe(3);
});

test("K&R gate keeps the full request lifetime and 2.5-second settled gap serial", async () => {
  const starts: number[] = [],
    ends: number[] = [];
  await Effect.runPromise(
    Effect.gen(function* () {
      const request = kandrRequestGate(
        Effect.gen(function* () {
          starts.push(yield* Clock.currentTimeMillis);
          yield* Effect.sleep("3 seconds");
          ends.push(yield* Clock.currentTimeMillis);
        }),
      );
      const first = yield* Effect.fork(request),
        second = yield* Effect.fork(request);
      yield* TestClock.adjust("11 seconds");
      yield* Fiber.join(first);
      yield* Fiber.join(second);
    }).pipe(Effect.provide(TestContext.TestContext)),
  );
  expect(starts).toHaveLength(2);
  expect((starts[1] ?? 0) - (ends[0] ?? 0)).toBe(2500);
});

test("K&R replays 56 actual HTTP bodies through client, durable cursor and complete quality guards", async () => {
  const responses = [
    kandrFixture.controls,
    ...kandrFixture.opening,
    ...kandrFixture.details,
    ...kandrFixture.closing,
  ];
  let calls = 0,
    emitted = 0;
  globalThis.fetch = Object.assign(
    async (input: string | URL | Request, init?: RequestInit) => {
      const expected = responses[calls++];
      expect(input).toBe(expected?.url ?? "missing");
      expect(init?.method).toBe("GET");
      expect(init?.redirect).toBe("manual");
      if (!expected) throw new Error("Unexpected native request");
      return new Response(expected.html, {
        headers: {
          "content-type": "text/html; charset=UTF-8",
          "content-length": String(Buffer.byteLength(expected.html)),
        },
      });
    },
    { preconnect: original.preconnect },
  );
  const contract = { minimumUniqueInventory: 40 };
  let cursor: unknown;
  while (true) {
    const result = await Effect.runPromise(
      streamKandrInventory({
        contract,
        startCursor: cursor,
        previousUniqueInventory: null,
        readPage: (url) => readKandrPage(url, gate),
        onBatch: (vehicles) =>
          Effect.sync(() => {
            emitted += vehicles.length;
          }),
      }),
    );
    const wire = KandrCursor.serialize(result.cursor, contract);
    if (!wire.ok) throw new Error(wire.error.message);
    cursor = wire.value;
    if (result.status === "complete") {
      expect(result.observedVins).toEqual(["3HSDJSJR0DN170483"]);
      expect(result.accounting.recordsRejected).toBe(1);
      break;
    }
  }
  expect(calls).toBe(56);
  expect(emitted).toBe(48);
});
test("K&R stops at a 503 asking for a long wait and keeps the cooldown behind its KandrError", async () => {
  let calls = 0;
  globalThis.fetch = Object.assign(
    async () => {
      calls++;
      return new Response("maintenance", {
        status: 503,
        headers: { "Retry-After": "900" },
      });
    },
    { preconnect: original.preconnect },
  );
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const fiber = yield* Effect.fork(readKandrPage(KANDR_CONTROLS, gate));
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
  expect(result.left.tag).toBe("KandrError");
  expect(findProviderCooldownError(result.left)?.retryAfterMs).toBe(900_000);
});
