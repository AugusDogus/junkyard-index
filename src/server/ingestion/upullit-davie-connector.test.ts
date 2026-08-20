import { afterEach, describe, expect, test } from "bun:test";
import { Effect } from "effect";
import {
  streamUpullitDavieInventory,
  UPULLIT_DAVIE_MAX_CATALOG_PAGES,
} from "./upullit-davie-connector";
import type { CanonicalVehicle } from "./types";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function providerVehicle(index: number) {
  return {
    id: `vehicle-${index}`,
    stockNumber: `U${String(index).padStart(6, "0")}`,
    vin: `VIN${String(index).padStart(14, "0")}`,
    year: 2012,
    make: "HONDA",
    model: "ACCORD",
    trim: null,
    color: null,
    engine: null,
    transmission: null,
    dateArrived: "2026-08-19T09:13:47.077Z",
    row: String(index),
    space: null,
    imageUrl: null,
  };
}

describe("U Pull It Davie catalog streaming", () => {
  test("resumes from a durable page cursor and validates the final count", async () => {
    const requestedPages: number[] = [];
    globalThis.fetch = Object.assign(
      async (input: RequestInfo | URL) => {
        const url = new URL(
          input instanceof Request ? input.url : input.toString(),
        );
        const page = Number.parseInt(url.searchParams.get("page") ?? "", 10);
        requestedPages.push(page);
        const start = (page - 1) * 2;
        const vehicles =
          page < 3
            ? [providerVehicle(start), providerVehicle(start + 1)]
            : [providerVehicle(start)];
        return new Response(
          JSON.stringify({
            vehicles,
            totalCount: 5,
            page,
            pageSize: 2,
            totalPages: 3,
          }),
          { status: 200 },
        );
      },
      { preconnect: originalFetch.preconnect },
    );

    const firstBatches: CanonicalVehicle[][] = [];
    const first = await Effect.runPromise(
      streamUpullitDavieInventory({
        maxPages: 2,
        onBatch: (vehicles) =>
          Effect.sync(() => {
            firstBatches.push(vehicles);
          }),
      }),
    );
    expect(first).toMatchObject({
      status: "paused",
      pagesProcessed: 2,
      count: 4,
      cursor: {
        page: 3,
        totalPages: 3,
        totalCount: 5,
        recordsProcessed: 4,
      },
    });

    const secondBatches: CanonicalVehicle[][] = [];
    const second = await Effect.runPromise(
      streamUpullitDavieInventory({
        startCursor: first.cursor,
        maxPages: 2,
        onBatch: (vehicles) =>
          Effect.sync(() => {
            secondBatches.push(vehicles);
          }),
      }),
    );
    expect(second).toMatchObject({
      status: "complete",
      pagesProcessed: 1,
      count: 1,
      cursor: {
        page: 4,
        totalPages: 3,
        totalCount: 5,
        recordsProcessed: 5,
      },
    });
    expect(firstBatches.flat()).toHaveLength(4);
    expect(secondBatches.flat()).toHaveLength(1);
    expect(requestedPages).toEqual([1, 2, 3]);
  });

  test("rejects pagination metadata above the catalog safety ceiling", async () => {
    globalThis.fetch = Object.assign(
      async () =>
        new Response(
          JSON.stringify({
            vehicles: [providerVehicle(0)],
            totalCount: UPULLIT_DAVIE_MAX_CATALOG_PAGES + 1,
            page: 1,
            pageSize: 1,
            totalPages: UPULLIT_DAVIE_MAX_CATALOG_PAGES + 1,
          }),
          { status: 200 },
        ),
      { preconnect: originalFetch.preconnect },
    );

    await expect(
      Effect.runPromise(
        streamUpullitDavieInventory({ onBatch: () => Effect.void }),
      ),
    ).rejects.toThrow("exceeded the maximum catalog size");
  });

  test("rejects page-size changes across a catalog", async () => {
    globalThis.fetch = Object.assign(
      async (input: RequestInfo | URL) => {
        const url = new URL(
          input instanceof Request ? input.url : input.toString(),
        );
        const page = Number.parseInt(url.searchParams.get("page") ?? "", 10);
        return new Response(
          JSON.stringify({
            vehicles:
              page === 1
                ? [providerVehicle(0), providerVehicle(1)]
                : [providerVehicle(2)],
            totalCount: 3,
            page,
            pageSize: page === 1 ? 2 : 3,
            totalPages: 2,
          }),
          { status: 200 },
        );
      },
      { preconnect: originalFetch.preconnect },
    );

    await expect(
      Effect.runPromise(
        streamUpullitDavieInventory({ onBatch: () => Effect.void }),
      ),
    ).rejects.toThrow("page size changed during ingestion");
  });

  test("does not mark a catalog healthy after discarding invalid records", async () => {
    globalThis.fetch = Object.assign(
      async () =>
        new Response(
          JSON.stringify({
            vehicles: [{ ...providerVehicle(0), vin: "" }],
            totalCount: 1,
            page: 1,
            pageSize: 1,
            totalPages: 1,
          }),
          { status: 200 },
        ),
      { preconnect: originalFetch.preconnect },
    );

    await expect(
      Effect.runPromise(
        streamUpullitDavieInventory({ onBatch: () => Effect.void }),
      ),
    ).rejects.toThrow("discarded 1 invalid record");
  });
});
