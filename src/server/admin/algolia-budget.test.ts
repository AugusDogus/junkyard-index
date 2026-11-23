import { describe, expect, test } from "bun:test";
import { PRODUCTION_ALGOLIA_APP_ID } from "~/lib/algolia-deployment";
import { AlgoliaBudget, type AlgoliaAccess } from "./algolia-budget";

const ACCESS: AlgoliaAccess = {
  appId: PRODUCTION_ALGOLIA_APP_ID,
  apiKey: "test-admin-key",
  deployment: "production",
};

function fakeFetch(status: number, body: unknown) {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  return {
    calls,
    fetch: async (url: string, init: { headers: Record<string, string> }) => {
      calls.push({ url, headers: init.headers });
      return new Response(JSON.stringify(body), { status });
    },
  };
}

describe("AlgoliaBudget.records", () => {
  test("counts records in every index that is not a virtual replica", async () => {
    const { fetch, calls } = fakeFetch(200, {
      items: [
        { name: "vehicles", entries: 519_999 },
        { name: "vehicles_newest", entries: 519_999, virtual: true },
        { name: "yards", entries: 10 },
      ],
      nbPages: 1,
    });
    expect(await AlgoliaBudget.records(ACCESS, fetch)).toEqual({
      kind: "read",
      value: 520_009,
    });
    expect(calls).toEqual([
      {
        url: `https://${PRODUCTION_ALGOLIA_APP_ID}.algolia.net/1/indexes`,
        headers: {
          "X-Algolia-Application-Id": PRODUCTION_ALGOLIA_APP_ID,
          "X-Algolia-API-Key": "test-admin-key",
        },
      },
    ]);
  });

  test("reads nothing outside production when the app is production's", async () => {
    const { fetch, calls } = fakeFetch(200, {});
    expect(
      await AlgoliaBudget.records({ ...ACCESS, deployment: "preview" }, fetch),
    ).toEqual({ kind: "production_only" });
    expect(calls).toEqual([]);
  });

  test("a refused read says what Algolia answered, without the key", async () => {
    const { fetch } = fakeFetch(403, {
      status: 403,
      message: "Method not allowed with this API key",
    });
    const read = AlgoliaBudget.records(ACCESS, fetch);
    await expect(read).rejects.toThrow(
      /list indices.*403.*Method not allowed with this API key/s,
    );
    await expect(read).rejects.not.toThrow(/test-admin-key/);
  });
});

describe("AlgoliaBudget.topSearches", () => {
  test("merges each index's top queries of the last 7 days into the top 20", async () => {
    const calls: string[] = [];
    const fetch = async (url: string) => {
      calls.push(url);
      const searches = url.includes("index=vehicles_newest&")
        ? [
            { search: "civic", count: 10, nbHits: 300 },
            { search: "f150", count: 15, nbHits: 90 },
          ]
        : [
            { search: "civic", count: 12, nbHits: 300 },
            { search: "", count: 4, nbHits: 500_000 },
          ];
      return new Response(JSON.stringify({ searches }), { status: 200 });
    };
    expect(
      await AlgoliaBudget.topSearches(
        ACCESS,
        ["vehicles", "vehicles_newest"],
        new Date("2026-11-22T12:00:00Z"),
        fetch,
      ),
    ).toEqual({
      kind: "read",
      value: [
        { query: "civic", count: 22 },
        { query: "f150", count: 15 },
        { query: "", count: 4 },
      ],
    });
    expect(calls).toEqual([
      "https://analytics.algolia.com/2/searches?index=vehicles&startDate=2026-11-16&endDate=2026-11-22&limit=100",
      "https://analytics.algolia.com/2/searches?index=vehicles_newest&startDate=2026-11-16&endDate=2026-11-22&limit=100",
    ]);
  });

  test("keeps the 20 most searched", async () => {
    const fetch = async () =>
      new Response(
        JSON.stringify({
          searches: Array.from({ length: 30 }, (_, index) => ({
            search: `q${index}`,
            count: index,
          })),
        }),
        { status: 200 },
      );
    const top = await AlgoliaBudget.topSearches(
      ACCESS,
      ["vehicles"],
      new Date("2026-11-22T12:00:00Z"),
      fetch,
    );
    expect(top.kind === "read" ? top.value.map((s) => s.count) : []).toEqual(
      Array.from({ length: 20 }, (_, index) => 29 - index),
    );
  });
});
