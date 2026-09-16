import { afterEach, expect, test } from "bun:test";
import { Effect } from "effect";
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
  globalThis.fetch = Object.assign(
    async () => Response.json(body, { status }),
    {
      preconnect: originalFetch.preconnect,
    },
  );
}

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
    respond(body);
    const result = await Effect.runPromise(
      Effect.either(fetchUpullRPartsImage("UG072546")),
    );
    expect(result._tag).toBe("Left");
  },
);

test("propagates a failed photo request rather than silently removing an existing photo", async () => {
  respond({ error: "unavailable" }, 403);
  const result = await Effect.runPromise(
    Effect.either(fetchUpullRPartsImage("UG072546")),
  );
  expect(result._tag).toBe("Left");
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
