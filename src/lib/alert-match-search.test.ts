import type { SearchResponse } from "algoliasearch/lite";
import type { AlgoliaVehicleHit } from "~/lib/search-vehicles";
import { describe, expect, test } from "bun:test";
import {
  getAlertMatchStatsWithClient,
  getAlertMatchStatsBatchWithClient,
  type AlertSearchClient,
} from "./alert-match-search";
import { filtersSchema } from "./saved-search-filters";

function emptySearchClient(onSearch?: (input: unknown) => void) {
  return {
    async searchForHits(input: unknown) {
      onSearch?.(input);
      return {
        results: [
          {
            hits: [],
            nbHits: 0,
            page: 0,
            nbPages: 0,
            hitsPerPage: 100,
            processingTimeMS: 1,
            query: "",
          },
        ],
      };
    },
  } satisfies AlertSearchClient;
}

describe("alert match search", () => {
  test("saved plain year ranges match the same numeric intersection as live search", async () => {
    const requests: unknown[] = [];
    await getAlertMatchStatsWithClient(
      emptySearchClient((input) => requests.push(input)),
      "2010-14 Ford F-150",
      { minYear: 2012, maxYear: 2016 },
      null,
    );
    expect(requests[0]).toMatchObject({
      requests: [
        {
          query: "Ford F-150",
          filters:
            "year >= 2012 AND year <= 2016 AND year >= 2010 AND year <= 2014",
        },
      ],
    });
  });
  test("saved distance sorts still scan the primary without geo restrictions", async () => {
    for (const sortBy of ["distance", "vehicles_distance"]) {
      const requests: unknown[] = [];
      await getAlertMatchStatsWithClient(
        emptySearchClient((input) => requests.push(input)),
        "civic",
        filtersSchema.parse({ sortBy, makes: ["Honda"] }),
        null,
      );
      expect(requests[0]).toEqual({
        requests: [
          {
            indexName: "vehicles",
            query: "civic",
            filters: 'make:"Honda"',
            advancedSyntax: true,
            advancedSyntaxFeatures: ["exactPhrase", "excludeWords"],
            hitsPerPage: 100,
            page: 0,
            attributesToRetrieve: expect.any(Array),
            attributesToHighlight: [],
            attributesToSnippet: [],
          },
        ],
      });
    }
  });
  test("compiles filters and scans through an injected search client", async () => {
    const requests: unknown[] = [];
    const result = await getAlertMatchStatsWithClient(
      emptySearchClient((input) => requests.push(input)),
      " civic ",
      { makes: ["Honda"] },
      new Date("2026-08-25T00:00:00.000Z"),
    );

    expect(result).toEqual({
      matchedCount: 0,
      completion: { status: "complete" },
      vehicles: [],
    });
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      requests: [
        {
          query: "civic",
          filters: 'firstSeenAt > 1787616000 AND make:"Honda"',
          hitsPerPage: 100,
          page: 0,
        },
      ],
    });
  });

  test("does not search when filter compilation cannot match", async () => {
    let searchCalls = 0;
    const result = await getAlertMatchStatsWithClient(
      emptySearchClient(() => {
        searchCalls += 1;
      }),
      "",
      { vinPattern: "invalid" },
      null,
    );

    expect(result).toEqual({
      matchedCount: 0,
      completion: { status: "complete" },
      vehicles: [],
    });
    expect(searchCalls).toBe(0);
  });

  test("translates advanced syntax for saved-search alerts", async () => {
    const requests: unknown[] = [];
    await getAlertMatchStatsWithClient(
      emptySearchClient((input) => requests.push(input)),
      'pickup (Ford OR Ram) "crew cab" !diesel',
      {},
      null,
    );

    expect(requests[0]).toMatchObject({
      requests: [
        {
          query: 'pickup "crew cab" -diesel',
          filters: '(searchTokens:"ford" OR searchTokens:"ram")',
          advancedSyntax: true,
          advancedSyntaxFeatures: ["exactPhrase", "excludeWords"],
        },
      ],
    });
  });
});

test("expression alerts retain the time window outside Boolean alternatives", async () => {
  const requests: unknown[] = [];
  await getAlertMatchStatsWithClient(
    emptySearchClient((input) => requests.push(input)),
    "",
    { expression: "(make:Volvo OR make:Saab) year:<2000" },
    new Date("2026-08-25T00:00:00Z"),
  );
  expect(requests[0]).toMatchObject({
    requests: [
      {
        query: "",
        filters:
          '(make:"Volvo" OR make:"Saab") AND year < 2000 AND firstSeenAt > 1787616000',
      },
    ],
  });
});

test("invalid expression fails matching instead of completing an empty alert window", async () => {
  let called = false;
  await expect(
    getAlertMatchStatsWithClient(
      emptySearchClient(() => {
        called = true;
      }),
      "",
      { expression: "make:Volvo OR year:<2000" },
      null,
    ),
  ).rejects.toThrow("Cannot match saved search expression");
  expect(called).toBe(false);
});

test("batches alert windows into at most 50 queries per request", async () => {
  const requests: unknown[] = [];
  const client: AlertSearchClient = {
    async searchForHits(
      input: Parameters<AlertSearchClient["searchForHits"]>[0],
    ) {
      requests.push(input);
      return {
        results: input.requests.map(
          () =>
            ({
              hits: [],
              nbHits: 0,
              nbPages: 0,
              page: 0,
              hitsPerPage: 100,
              processingTimeMS: 1,
              query: "",
            }) satisfies SearchResponse<AlgoliaVehicleHit>,
        ),
      };
    },
  };
  const results = await getAlertMatchStatsBatchWithClient(
    client,
    Array.from({ length: 103 }, (_, i) => ({
      query: `query-${i}`,
      filters: {},
      lastCheckedAt: new Date(1000),
    })),
    { checkedThrough: new Date(2000), latestFirstSeenAt: new Date(2000) },
  );
  expect(results).toHaveLength(103);
  expect(
    results.every(
      (result) =>
        result.status === "fulfilled" &&
        result.value.completion.status === "complete",
    ),
  ).toBe(true);
  expect(requests).toHaveLength(3);
  expect(requests).toMatchObject([
    { requests: Array.from({ length: 50 }, () => ({})) },
    { requests: Array.from({ length: 50 }, () => ({})) },
    { requests: [{}, {}, {}] },
  ]);
});

test("skips windows without newer firstSeenAt seconds, including empty and failed publications", async () => {
  let calls = 0;
  const client = emptySearchClient(() => {
    calls += 1;
  });
  const searches = [{ query: "", filters: {}, lastCheckedAt: new Date(1999) }];
  for (const latest of [null, new Date(1000), new Date(1999)]) {
    const results = await getAlertMatchStatsBatchWithClient(client, searches, {
      checkedThrough: new Date(5000),
      latestFirstSeenAt: latest,
    });
    expect(results[0]).toEqual({
      status: "fulfilled",
      value: {
        matchedCount: 0,
        completion: { status: "complete" },
        vehicles: [],
      },
    });
  }
  expect(calls).toBe(0);
  await getAlertMatchStatsBatchWithClient(client, searches, {
    checkedThrough: new Date(2000),
    latestFirstSeenAt: new Date(2000),
  });
  expect(calls).toBe(1);
});

test("batched pagination retains each search's matches and incomplete scan handling", async () => {
  const requests: number[] = [];
  const client: AlertSearchClient = {
    async searchForHits({ requests: batch }) {
      requests.push(batch.length);
      return {
        results: batch
          .filter((request) => request.query !== "missing")
          .map((request) => {
            const hits = Array.from(
              {
                length:
                  request.query === "paged" && request.page === 0 ? 100 : 1,
              },
              (_, index) => ({
                objectID: `${request.query}-${request.page}-${index}`,
                source: "pyp",
                vin: `${request.query}-${request.page}-${index}`,
              }),
            );
            return {
              hits,
              nbHits: request.query === "paged" ? 101 : 1,
              nbPages: request.query === "paged" ? 2 : 1,
              exhaustiveNbHits: true,
              page: request.page,
              hitsPerPage: 100,
              processingTimeMS: 1,
              query: request.query,
            };
          }),
      };
    },
  };
  const searches = ["paged", "short", "missing"].map((query) => ({
    query,
    filters: {},
    lastCheckedAt: new Date(1000),
  }));
  const batched = await getAlertMatchStatsBatchWithClient(client, searches, {
    checkedThrough: new Date(2000),
    latestFirstSeenAt: new Date(2000),
  });
  expect(requests).toEqual([3, 1]);
  for (const [index, search] of searches.entries()) {
    const individual = await getAlertMatchStatsWithClient(
      client,
      search.query,
      search.filters,
      search.lastCheckedAt,
    );
    expect(batched[index]).toEqual({ status: "fulfilled", value: individual });
  }
  expect(batched[0]).toMatchObject({ value: { matchedCount: 101 } });
  expect(batched[2]).toMatchObject({
    value: { completion: { status: "incomplete", reason: "missing-page" } },
  });
});

test("batched request failures remain failures for each affected search", async () => {
  const failure = new Error("Algolia unavailable");
  const results = await getAlertMatchStatsBatchWithClient(
    {
      async searchForHits() {
        throw failure;
      },
    },
    [{ query: "", filters: {}, lastCheckedAt: new Date(1000) }],
    { checkedThrough: new Date(2000), latestFirstSeenAt: new Date(2000) },
  );
  expect(results).toEqual([{ status: "rejected", reason: failure }]);
});

test("batched skipped windows still reject invalid expressions", async () => {
  const results = await getAlertMatchStatsBatchWithClient(
    emptySearchClient(),
    [
      {
        query: "",
        filters: { expression: "make:Volvo OR year:<2000" },
        lastCheckedAt: new Date(2000),
      },
    ],
    { checkedThrough: new Date(5000), latestFirstSeenAt: null },
  );
  expect(results[0]).toMatchObject({ status: "rejected" });
});

test("batched matches stop at the checked-through second", async () => {
  const requests: unknown[] = [];
  await getAlertMatchStatsBatchWithClient(
    emptySearchClient((input) => requests.push(input)),
    [
      {
        query: "",
        filters: { makes: ["Ford"] },
        lastCheckedAt: new Date(1999),
      },
    ],
    { checkedThrough: new Date(5999), latestFirstSeenAt: new Date(4000) },
  );
  expect(requests).toMatchObject([
    {
      requests: [
        { filters: 'firstSeenAt > 1 AND firstSeenAt <= 5 AND make:"Ford"' },
      ],
    },
  ]);
});
