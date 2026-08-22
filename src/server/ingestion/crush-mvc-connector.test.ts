import { afterEach, describe, expect, test } from "bun:test";
import { Effect } from "effect";
import {
  streamCrushMvcInventory,
  type CrushMvcStreamResult,
} from "./crush-mvc-connector";
import type { CrushMvcSiteConfig } from "./crush-mvc-config";
import type { RawCrushListing } from "./crush-mvc-transform";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function resultsHtml(rows: Array<[string, string, string]>): string {
  const header =
    "<tr><th>YEAR</th><th>MAKE</th><th>MODEL</th><th>ROW</th></tr>";
  const body = rows
    .map(
      ([year, model, row]) =>
        `<tr><td>${year}</td><td style="font-weight: 700">FORD</td><td style="font-weight: 700">${model}</td><td>${row}</td></tr>`,
    )
    .join("\n");
  return `<html><body><table class="table">${header}${body}</table></body></html>`;
}

const TEST_SITES: CrushMvcSiteConfig[] = [
  {
    siteId: "site-a",
    displayName: "Site A",
    baseUrl: "https://site-a.test",
    inventoryPath: "/",
    yards: [
      {
        yardId: 10,
        name: "A1",
        city: null,
        stateAbbr: null,
        lat: null,
        lng: null,
      },
      {
        yardId: 20,
        name: "A2",
        city: null,
        stateAbbr: null,
        lat: null,
        lng: null,
      },
    ],
  },
  {
    siteId: "site-b",
    displayName: "Site B",
    baseUrl: "https://site-b.test",
    inventoryPath: "/Home/Inventory",
    yards: [
      {
        yardId: null,
        name: "B1",
        city: null,
        stateAbbr: null,
        lat: null,
        lng: null,
      },
    ],
  },
];

async function runStream(options: {
  sites?: readonly CrushMvcSiteConfig[];
  startPageIndex?: number;
  maxPages?: number;
}): Promise<{ result: CrushMvcStreamResult; batches: RawCrushListing[][] }> {
  const batches: RawCrushListing[][] = [];
  const result = await Effect.runPromise(
    streamCrushMvcInventory({
      sites: options.sites ?? TEST_SITES,
      startPageIndex: options.startPageIndex,
      maxPages: options.maxPages,
      onBatch: (listings) =>
        Effect.sync(() => {
          batches.push(listings);
        }),
    }),
  );
  return { result, batches };
}

describe("streamCrushMvcInventory", () => {
  test("streams one page per yard with yard context attached", async () => {
    const requestedBodies: string[] = [];
    globalThis.fetch = Object.assign(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        requestedBodies.push(String(init?.body));
        return new Response(resultsHtml([["2010", "FOCUS", "12"]]), {
          status: 200,
        });
      },
    );

    const { result, batches } = await runStream({});

    expect(result).toEqual({
      source: "crush-mvc",
      status: "complete",
      cursor: 3,
      count: 3,
      errors: [],
      pagesProcessed: 3,
    });
    expect(batches.map((batch) => batch.length)).toEqual([1, 1, 1]);
    expect(batches[0]?.[0]).toMatchObject({
      year: 2010,
      make: "FORD",
      model: "FOCUS",
      row: "12",
      yardId: 10,
      yardName: "A1",
      sourceUrl: "https://site-a.test/",
    });
    expect(batches[2]?.[0]).toMatchObject({
      yardId: null,
      yardName: "B1",
      sourceUrl: "https://site-b.test/Home/Inventory",
    });
    expect(requestedBodies[0]).toBe("VehicleMake=&VehicleModel=&YardId=10");
    expect(requestedBodies[2]).toBe("VehicleMake=&VehicleModel=");
  });

  test("deduplicates identical listings within a page", async () => {
    globalThis.fetch = Object.assign(async () => {
      return new Response(
        resultsHtml([
          ["2010", "FOCUS", "12"],
          ["2010", "FOCUS", "12"],
        ]),
        { status: 200 },
      );
    });

    const { result, batches } = await runStream({});

    expect(result.count).toBe(3);
    expect(batches.map((batch) => batch.length)).toEqual([1, 1, 1]);
  });

  test("pauses at maxPages and resumes from the returned cursor", async () => {
    let requests = 0;
    globalThis.fetch = Object.assign(async () => {
      requests += 1;
      return new Response(resultsHtml([["2010", "FUSION", String(requests)]]), {
        status: 200,
      });
    });

    const paused = await runStream({ maxPages: 1 });
    expect(paused.result).toMatchObject({
      status: "paused",
      cursor: 1,
      pagesProcessed: 1,
    });
    expect(requests).toBe(1);

    const resumed = await runStream({ startPageIndex: paused.result.cursor });
    expect(resumed.result).toMatchObject({
      status: "complete",
      cursor: 3,
      pagesProcessed: 2,
    });
    expect(requests).toBe(3);
  });

  test("fails with a provider error when a site is unreachable", async () => {
    const failingSite = TEST_SITES[0];
    if (!failingSite) throw new Error("test sites are not configured");
    globalThis.fetch = Object.assign(async () => {
      return new Response("nope", { status: 500 });
    });

    const error = await Effect.runPromiseExit(
      streamCrushMvcInventory({
        sites: [failingSite],
        onBatch: () => Effect.void,
      }),
    );
    expect(error._tag).toBe("Failure");
    if (error._tag === "Failure") {
      expect(String(error.cause)).toContain(
        "CRUSH MVC inventory error for site=site-a",
      );
    }
  });
});
