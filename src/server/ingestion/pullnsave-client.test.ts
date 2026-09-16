import { afterEach, describe, expect, test } from "bun:test";
import { Effect, Schema } from "effect";
import {
  buildPullNSaveImageUrl,
  fetchPullNSavePage,
  PullNSaveSearchPageSchema,
} from "./pullnsave-client";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function fixtureFile(fileName: string): Promise<string> {
  return Bun.file(new URL(`./fixtures/${fileName}`, import.meta.url)).text();
}

describe("PullNSaveSearchPageSchema", () => {
  test("accepts usable records without unused internal vehicle and store IDs", () => {
    const record = {
      astStoreNumber: 1,
      stockId: "STK082202-1",
      vin: "1G1JF52F437297781",
      year: 2003,
      make: "CHEVROLET",
      model: "CAVALIER",
    };
    expect(
      Schema.decodeUnknownSync(PullNSaveSearchPageSchema)([record]),
    ).toEqual([record]);
  });
  test("decodes the live page-1 fixture", async () => {
    const raw = JSON.parse(await fixtureFile("pullnsave-search-page1.json"));
    const page = Schema.decodeUnknownSync(PullNSaveSearchPageSchema)(raw);

    expect(page).toHaveLength(100);
    const first = page[0]!;
    expect(first.astStoreNumber).toBe(1);
    expect(first.vin).toBe("1G1JF52F437297781");
    expect(first.year).toBe(2003);
    expect(first.make).toBe("CHEVROLET");
    expect(first.model).toBe("CAVALIER");
    expect(first.color).toBe("WHITE");
    expect(first.stockId).toBe("STK082202-1");
    expect(first.rcvdDtTm).toBe("2021-06-01T09:00:00");
    expect(first.yardRow).toBe(94);
  });

  test("decodes the mixed-yards fixture across all store numbers", async () => {
    const raw = JSON.parse(
      await fixtureFile("pullnsave-search-mixed-yards.json"),
    );
    const page = Schema.decodeUnknownSync(PullNSaveSearchPageSchema)(raw);

    expect(page).toHaveLength(18);
    expect([...new Set(page.map((row) => row.astStoreNumber))].sort()).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9,
    ]);
  });
});

describe("fetchPullNSavePage", () => {
  test("posts pageNumber/pageSize and decodes the response", async () => {
    const requests: Array<{ url: string; body: string | null }> = [];
    const raw = await fixtureFile("pullnsave-search-page1.json");
    globalThis.fetch = Object.assign(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        requests.push({
          url: input instanceof Request ? input.url : input.toString(),
          body: typeof init?.body === "string" ? init.body : null,
        });
        return new Response(raw, { status: 200 });
      },
      { preconnect: originalFetch.preconnect },
    );

    const page = await Effect.runPromise(
      fetchPullNSavePage({ pageNumber: 7, pageSize: 100 }),
    );

    expect(requests).toEqual([
      {
        url: "https://app.pullnsaveapp.com/v1/Vehicles/Search",
        body: JSON.stringify({ pageNumber: 7, pageSize: 100 }),
      },
    ]);
    expect(page).toHaveLength(100);
  });

  test("fails with a provider error on non-JSON bodies", async () => {
    globalThis.fetch = Object.assign(
      async () =>
        new Response("<p>There has been a critical error</p>", { status: 500 }),
      { preconnect: originalFetch.preconnect },
    );

    const result = await Effect.runPromiseExit(
      fetchPullNSavePage({ pageNumber: 1, pageSize: 100 }),
    );
    expect(result._tag).toBe("Failure");
  });
});

describe("buildPullNSaveImageUrl", () => {
  test("retains legacy stock identifiers and their yard suffix", () => {
    expect(buildPullNSaveImageUrl("STK091580-1", 1)).toBe(
      "https://app.pullnsaveapp.com/v1/Vehicles/Images/StockId/STK091580-1/OrderId/1",
    );
  });

  test("encodes stock IDs as one path segment without changing the image order", () => {
    // Synthetic encoding case: no special-character stock IDs occurred in the live audit.
    const url = new URL(buildPullNSaveImageUrl("STK 12/3?#%&+-9", 4));
    expect(url.pathname).toBe(
      "/v1/Vehicles/Images/StockId/STK%2012%2F3%3F%23%25%26%2B-9/OrderId/4",
    );
    expect(url.search).toBe("");
    expect(url.hash).toBe("");
  });

  test("builds the stock image endpoint used by pullnsave.com", () => {
    expect(buildPullNSaveImageUrl("STK044481-5", 1)).toBe(
      "https://app.pullnsaveapp.com/v1/Vehicles/Images/StockId/STK044481-5/OrderId/1",
    );
  });
});
