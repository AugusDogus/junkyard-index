import { describe, expect, test } from "bun:test";
import {
  getAlertMatchStatsWithClient,
  type AlertSearchClient,
} from "./alert-match-search";

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
          query: 'pickup Ford Ram "crew cab" -diesel',
          optionalWords: ["Ford", "Ram"],
          advancedSyntax: true,
          advancedSyntaxFeatures: ["exactPhrase", "excludeWords"],
        },
      ],
    });
  });
});
