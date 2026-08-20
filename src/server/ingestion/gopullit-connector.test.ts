import { afterEach, describe, expect, test } from "bun:test";
import { Effect, Fiber, TestClock, TestContext } from "effect";
import {
  GOPULLIT_MAX_CATALOG_PAGES,
  streamGopullitInventory,
  streamGopullitInventoryWithRequestGate,
} from "./gopullit-connector";
import type { ProviderRequestGate } from "./provider-http-client";
import type { CanonicalVehicle } from "./types";

const originalFetch = globalThis.fetch;
const noRateLimit: ProviderRequestGate = (request) => request;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function completeRecord(index: number) {
  return {
    id: 333000 + index,
    title: `GPI${String(index).padStart(7, "0")}`,
    created_at: "2026-08-18 20:19:59",
    location: String(100 + index),
    make: "HONDA",
    model: "ACCORD",
    vin: `VIN${String(index).padStart(14, "0")}`,
    yardCity: "JACKSONVILLE ",
    yardDate: "08/17/26",
    yardState: "FL",
    year: "2012",
  };
}

describe("GO Pull-It catalog streaming", () => {
  test("paces provider requests below the observed rate limit", async () => {
    let requestCount = 0;
    globalThis.fetch = Object.assign(
      async (input: RequestInfo | URL) => {
        const url = new URL(
          input instanceof Request ? input.url : input.toString(),
        );
        const page = Number.parseInt(url.searchParams.get("page") ?? "", 10);
        requestCount += 1;
        return new Response(
          JSON.stringify(
            Array.from({ length: 10 }, (_, index) =>
              completeRecord((page - 1) * 10 + index),
            ),
          ),
          { status: 200 },
        );
      },
      { preconnect: originalFetch.preconnect },
    );

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const streamFiber = yield* streamGopullitInventory({
          onBatch: () => Effect.void,
          maxPages: 2,
        }).pipe(Effect.fork);

        yield* TestClock.adjust("1 second");
        expect(requestCount).toBe(1);
        yield* TestClock.adjust("500 millis");

        return yield* Fiber.join(streamFiber);
      }).pipe(Effect.provide(TestContext.TestContext)),
    );

    expect(requestCount).toBe(2);
    expect(result).toMatchObject({ status: "paused", pagesProcessed: 2 });
  });

  test("crawls JSON pages until the first short page", async () => {
    const requestedUrls: URL[] = [];
    const requestCookies: Array<string | null> = [];
    globalThis.fetch = Object.assign(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(
          input instanceof Request ? input.url : input.toString(),
        );
        requestedUrls.push(url);
        const headers = new Headers(init?.headers);
        requestCookies.push(headers.get("cookie"));
        const page = Number.parseInt(url.searchParams.get("page") ?? "", 10);
        const body =
          page === 1
            ? Array.from({ length: 10 }, (_, index) => completeRecord(index))
            : page === 2
              ? [
                  completeRecord(10),
                  completeRecord(0),
                  {
                    id: 333600,
                    title: "203122103578",
                    created_at: "2026-08-18 20:20:04",
                  },
                ]
              : [];
        return new Response(JSON.stringify(body), {
          status: 200,
          headers:
            page === 1
              ? { "set-cookie": "__cf_bm=test-session; Path=/; Secure" }
              : undefined,
        });
      },
      { preconnect: originalFetch.preconnect },
    );

    const batches: CanonicalVehicle[][] = [];
    const result = await Effect.runPromise(
      streamGopullitInventoryWithRequestGate(
        {
          onBatch: (vehicles) =>
            Effect.sync(() => {
              batches.push(vehicles);
            }),
        },
        noRateLimit,
      ),
    );

    expect(result).toMatchObject({
      count: 11,
      pagesProcessed: 2,
      cursor: {
        page: 3,
        recordsProcessed: 13,
        recordsSkipped: 1,
      },
      status: "complete",
    });
    expect(batches.flat()).toHaveLength(11);
    expect(requestedUrls).toHaveLength(25);
    expect(requestCookies[0]).toBeNull();
    expect(
      requestCookies
        .slice(1)
        .every((cookie) => cookie === "__cf_bm=test-session"),
    ).toBe(true);
    expect(
      requestedUrls.every(
        (url) =>
          url.pathname === "/wp-json/apppresser/v1/inventory" &&
          url.searchParams.has("page") &&
          !url.searchParams.has("make") &&
          !url.searchParams.has("model"),
      ),
    ).toBe(true);
  });

  test("pauses at a durable page boundary", async () => {
    const requestedPages: number[] = [];
    globalThis.fetch = Object.assign(
      async (input: RequestInfo | URL) => {
        const url = new URL(
          input instanceof Request ? input.url : input.toString(),
        );
        const page = Number.parseInt(url.searchParams.get("page") ?? "", 10);
        requestedPages.push(page);
        return new Response(
          JSON.stringify(
            Array.from({ length: 10 }, (_, index) =>
              completeRecord((page - 1) * 10 + index),
            ),
          ),
          { status: 200 },
        );
      },
      { preconnect: originalFetch.preconnect },
    );

    const result = await Effect.runPromise(
      streamGopullitInventoryWithRequestGate(
        {
          onBatch: () => Effect.void,
          maxPages: 1,
          startCursor: {
            page: 4,
            recordsProcessed: 30,
            recordsSkipped: 30,
          },
        },
        noRateLimit,
      ),
    );

    expect(result).toMatchObject({
      cursor: {
        page: 5,
        recordsProcessed: 40,
        recordsSkipped: 30,
      },
      pagesProcessed: 1,
      status: "paused",
    });
    expect(requestedPages).toEqual([4]);
  });

  test("defers incomplete-record ratio validation until the catalog ends", async () => {
    globalThis.fetch = Object.assign(
      async () =>
        new Response(
          JSON.stringify(
            Array.from({ length: 10 }, (_, index) => ({
              id: 334000 + index,
              title: `placeholder-${index}`,
              created_at: "2026-08-18 20:20:04",
            })),
          ),
          { status: 200 },
        ),
      { preconnect: originalFetch.preconnect },
    );

    const result = await Effect.runPromise(
      streamGopullitInventoryWithRequestGate(
        { onBatch: () => Effect.void, maxPages: 1 },
        noRateLimit,
      ),
    );

    expect(result).toMatchObject({
      status: "paused",
      cursor: {
        page: 2,
        recordsProcessed: 10,
        recordsSkipped: 10,
      },
    });
  });

  test("rejects a catalog dominated by incomplete records", async () => {
    globalThis.fetch = Object.assign(
      async () =>
        new Response(
          JSON.stringify([
            {
              id: 333600,
              title: "203122103578",
              created_at: "2026-08-18 20:20:04",
            },
          ]),
          { status: 200 },
        ),
      { preconnect: originalFetch.preconnect },
    );

    await expect(
      Effect.runPromise(
        streamGopullitInventoryWithRequestGate(
          { onBatch: () => Effect.void },
          noRateLimit,
        ),
      ),
    ).rejects.toThrow("the catalog was not reconciled");
  });

  test("rejects a provider that never returns a terminal page", async () => {
    const requestedPages: number[] = [];
    globalThis.fetch = Object.assign(
      async (input: RequestInfo | URL) => {
        const url = new URL(
          input instanceof Request ? input.url : input.toString(),
        );
        const page = Number.parseInt(url.searchParams.get("page") ?? "", 10);
        requestedPages.push(page);
        return new Response(
          JSON.stringify(
            Array.from({ length: 10 }, (_, index) =>
              completeRecord((page - 1) * 10 + index),
            ),
          ),
          { status: 200 },
        );
      },
      { preconnect: originalFetch.preconnect },
    );

    await expect(
      Effect.runPromise(
        streamGopullitInventoryWithRequestGate(
          {
            onBatch: () => Effect.void,
            maxPages: 1,
            startCursor: {
              page: GOPULLIT_MAX_CATALOG_PAGES,
              recordsProcessed: (GOPULLIT_MAX_CATALOG_PAGES - 1) * 10,
              recordsSkipped: 0,
            },
          },
          noRateLimit,
        ),
      ),
    ).rejects.toThrow("exceeded the maximum catalog size");
    expect(requestedPages).toEqual([GOPULLIT_MAX_CATALOG_PAGES]);
  });
});
