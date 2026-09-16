import { afterEach, expect, test } from "bun:test";
import { Clock, Effect, Fiber, Runtime, TestClock, TestContext } from "effect";
import fixture from "./fixtures/upullrparts-images.json";
import partialResponses from "./fixtures/upullrparts-partial-images.json";
import {
  fetchUpullRPartsImage,
  loadUpullRPartsImages,
  UPULLRPARTS_IMAGE_CONCURRENCY,
} from "./upullrparts-images";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

function respond(body: unknown, status = 200) {
  let requests = 0;
  globalThis.fetch = Object.assign(
    async () => {
      requests++;
      return Response.json(body, { status });
    },
    {
      preconnect: originalFetch.preconnect,
    },
  );
  return () => requests;
}

test.each([1, 3])(
  "photo transport failures retry at most twice with backoff (%i failed attempts)",
  async (failures) => {
    const starts: number[] = [];
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const runPromise = Runtime.runPromise(yield* Effect.runtime());
        globalThis.fetch = Object.assign(
          async (_input: RequestInfo | URL, init?: RequestInit) => {
            starts.push(await runPromise(Clock.currentTimeMillis));
            expect(init?.body).toBe(
              "action=doAaaApiCall&apiAction=getVehicleImages&stockID=UG072546",
            );
            if (starts.length <= failures)
              throw new TypeError("fetch failed", {
                cause: Object.assign(new Error("socket reset"), {
                  code: "ECONNRESET",
                }),
              });
            return Response.json(fixture);
          },
          { preconnect: originalFetch.preconnect },
        );
        const fiber = yield* Effect.fork(
          Effect.either(fetchUpullRPartsImage("UG072546")),
        );
        yield* TestClock.adjust("3 seconds");
        return yield* Fiber.join(fiber);
      }).pipe(Effect.provide(TestContext.TestContext)),
    );
    expect(starts).toEqual(failures === 1 ? [0, 1000] : [0, 1000, 3000]);
    if (failures === 1) {
      expect(result).toMatchObject({
        _tag: "Right",
        right:
          "https://api.aaaparts.com/staticImages/UG072546_6_Facebook_1789479328434.jpg",
      });
    } else {
      expect(result._tag).toBe("Left");
      if (result._tag === "Left")
        expect(result.left.message).toContain(
          "stock UG072546 request failed: fetch failed",
        );
    }
  },
);

test("uses the public thumbnail order, falling back to a returned corner shot", async () => {
  respond(fixture);
  expect(await Effect.runPromise(fetchUpullRPartsImage("UG072546"))).toBe(
    "https://api.aaaparts.com/staticImages/UG072546_6_Facebook_1789479328434.jpg",
  );
  respond({ ...fixture, images: fixture.images.slice(0, 5) });
  expect(await Effect.runPromise(fetchUpullRPartsImage("UG072546"))).toBe(
    "https://api.aaaparts.com/staticImages/UG072546_3_RFCorner_1789479296717.jpg",
  );
});

test.each(["HTTP 503", "timeout"])(
  "transport and %s failures share one three-attempt budget",
  async (failure) => {
    const starts: number[] = [];
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const runPromise = Runtime.runPromise(yield* Effect.runtime());
        globalThis.fetch = Object.assign(
          async () => {
            starts.push(await runPromise(Clock.currentTimeMillis));
            if (starts.length === 1) throw new TypeError("fetch failed");
            if (failure === "timeout")
              throw new DOMException("request timed out", "TimeoutError");
            return new Response("temporarily unavailable", { status: 503 });
          },
          { preconnect: originalFetch.preconnect },
        );
        const fiber = yield* Effect.fork(
          Effect.either(fetchUpullRPartsImage("UG072546")),
        );
        yield* TestClock.adjust("3 seconds");
        return yield* Fiber.join(fiber);
      }).pipe(Effect.provide(TestContext.TestContext)),
    );
    expect(starts).toEqual([0, 1000, 3000]);
    expect(result._tag).toBe("Left");
    if (result._tag === "Left")
      expect(result.left.message).toContain(
        failure === "timeout" ? "timed out" : "HTTP status 503",
      );
  },
);

test("invalid JSON is a failed lookup, not a retry or an empty photo list", async () => {
  let requests = 0;
  globalThis.fetch = Object.assign(
    async () => {
      requests++;
      return new Response("not JSON");
    },
    { preconnect: originalFetch.preconnect },
  );
  const result = await Effect.runPromise(
    Effect.either(fetchUpullRPartsImage("UG072546")),
  );
  expect(requests).toBe(1);
  expect(result._tag).toBe("Left");
  if (result._tag === "Left")
    expect(result.left.message).toContain("invalid JSON");
});

test("keeps an explicit successful empty photo list as null", async () => {
  respond({ success: 1, images: [] });
  expect(await Effect.runPromise(fetchUpullRPartsImage("UG067069"))).toBeNull();
});

test.each(partialResponses)(
  "rejects partial empty image lists before accepting null: %j",
  async (init) => {
    let requests = 0;
    globalThis.fetch = Object.assign(
      async () => {
        requests++;
        return Response.json(
          { success: 1, images: [] },
          {
            status: init.status,
            headers: init.headerName
              ? { [init.headerName]: init.headerValue }
              : undefined,
          },
        );
      },
      { preconnect: originalFetch.preconnect },
    );
    const result = await Effect.runPromise(
      Effect.either(fetchUpullRPartsImage("UG072546")),
    );
    expect(result._tag).toBe("Left");
    if (result._tag === "Left") {
      expect(result.left.message).toContain("stock UG072546");
      expect(result.left.message).toContain("partial");
    }
    expect(requests).toBe(1);
  },
);

test("accepts a complete empty photo response with a non-pagination discovery link", async () => {
  globalThis.fetch = Object.assign(
    async () =>
      Response.json(
        { success: 1, images: [] },
        {
          headers: {
            Link: '<https://upullrparts.com/wp-json/>; rel="https://api.w.org/"',
          },
        },
      ),
    { preconnect: originalFetch.preconnect },
  );
  expect(await Effect.runPromise(fetchUpullRPartsImage("UG067069"))).toBeNull();
});

test.each([
  { success: false, images: [] },
  { success: 1 },
  {
    success: 1,
    images: [
      {
        fileName: "UG072546_6_Facebook_1789479328434.jpg",
        url: "https://upullrparts.com/wp-content/uploads/2026/08/upull-no-image-wide-300x200.png",
      },
    ],
  },
  {
    success: 1,
    images: [
      {
        fileName: "NG068336_6_Facebook_1789569607766.jpg",
        url: "https://api.aaaparts.com/staticImages/NG068336_6_Facebook_1789569607766.jpg",
      },
    ],
  },
])(
  "rejects failed, malformed, placeholder or mismatched-stock responses: %j",
  async (body) => {
    const requests = respond(body);
    const result = await Effect.runPromise(
      Effect.either(fetchUpullRPartsImage("UG072546")),
    );
    expect(result._tag).toBe("Left");
    expect(requests()).toBe(1);
  },
);

test("propagates a failed photo request rather than silently removing an existing photo", async () => {
  const requests = respond({ error: "unavailable" }, 403);
  const result = await Effect.runPromise(
    Effect.either(fetchUpullRPartsImage("UG072546")),
  );
  expect(result._tag).toBe("Left");
  expect(requests()).toBe(1);
  if (result._tag === "Left")
    expect(result.left.message).toContain("stock UG072546 returned HTTP 403");
});

test("bounds concurrent lookups, deduplicates stocks, and does not request missing stock", async () => {
  let active = 0;
  let peak = 0;
  const requested: string[] = [];
  globalThis.fetch = Object.assign(
    async (_input: RequestInfo | URL, init?: RequestInit) => {
      const params = new URLSearchParams(
        typeof init?.body === "string" ? init.body : "",
      );
      const stock = params.get("stockID") ?? "";
      requested.push(stock);
      active++;
      peak = Math.max(peak, active);
      await Bun.sleep(5);
      active--;
      return Response.json({
        success: 1,
        images: [
          {
            fileName: `${stock}_6_Facebook_123.jpg`,
            url: `https://api.aaaparts.com/staticImages/${stock}_6_Facebook_123.jpg`,
          },
        ],
      });
    },
    { preconnect: originalFetch.preconnect },
  );
  const stocks = Array.from({ length: 25 }, (_, i) => `UG${i}`);
  const result = await Effect.runPromise(
    loadUpullRPartsImages([...stocks, ...stocks, null]),
  );
  expect(peak).toBe(UPULLRPARTS_IMAGE_CONCURRENCY);
  expect(requested).toHaveLength(stocks.length);
  expect(result.size).toBe(stocks.length);
  for (const stock of stocks)
    expect(result.get(stock)).toBe(
      `https://api.aaaparts.com/staticImages/${stock}_6_Facebook_123.jpg`,
    );
});
