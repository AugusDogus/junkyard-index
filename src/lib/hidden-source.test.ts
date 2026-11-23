import { describe, expect, test } from "bun:test";
import type {
  LegacySearchMethodProps,
  SearchMethodParams,
} from "algoliasearch/lite";
import { HiddenSources } from "./hidden-source";

function recordingClient() {
  const calls: (SearchMethodParams | LegacySearchMethodProps)[] = [];
  return {
    calls,
    client: HiddenSources.withSearchClient({
      async search(input: SearchMethodParams | LegacySearchMethodProps) {
        calls.push(input);
        return { results: [] };
      },
    }),
  };
}

describe("HiddenSources", () => {
  // meeksrecycling.com redirects visitors to an unrelated site. Remove this
  // test with Meeks' entry once the site is restored (docs/runbooks/hide-source.md).
  test("hides Meeks while its website is compromised", () => {
    expect(HiddenSources.list).toContain("meeks");
    expect(HiddenSources.has("meeks")).toBe(true);
    expect(HiddenSources.has("pyp")).toBe(false);
  });

  test("unlisted sources are the hidden and retired ones", () => {
    expect(HiddenSources.unlisted).toEqual(
      expect.arrayContaining([
        ...HiddenSources.list,
        "upullitne",
        "brandywine",
      ]),
    );
  });

  test("drops hidden sources from a saved selection", () => {
    expect(
      HiddenSources.shown(["pyp", ...HiddenSources.list, "row52"]),
    ).toEqual(["pyp", "row52"]);
    expect(HiddenSources.shown([])).toEqual([]);
  });

  test("excludes every hidden source from an Algolia filter", () => {
    expect(HiddenSources.filterFor([])).toBeUndefined();
    expect(HiddenSources.filterFor(["meeks"])).toBe('NOT source:"meeks"');
    expect(HiddenSources.filterFor(["meeks", "pratt"])).toBe(
      'NOT source:"meeks" AND NOT source:"pratt"',
    );
    expect(HiddenSources.algoliaFilter).toBe(
      HiddenSources.filterFor(HiddenSources.list),
    );
  });

  test("adds the exclusion to a request's own filters", () => {
    const filter = HiddenSources.algoliaFilter;
    const unfiltered: { query: string; filters?: string } = { query: "civic" };
    expect(HiddenSources.exclude(unfiltered)).toEqual({
      query: "civic",
      filters: filter,
    });
    expect(
      HiddenSources.exclude({ query: "civic", filters: "year >= 2000" }),
    ).toEqual({
      query: "civic",
      filters: filter ? `year >= 2000 AND ${filter}` : "year >= 2000",
    });
  });

  test("filters every request a search client sends, in every request shape", async () => {
    const filter = HiddenSources.algoliaFilter;
    const { calls, client } = recordingClient();
    await client.search({
      requests: [
        { indexName: "vehicles", query: "civic", filters: "year >= 2000" },
        { indexName: "vehicles", type: "facet", facet: "make", query: "" },
        {
          indexName: "vehicles",
          params: "query=civic&filters=year%20%3E%3D%202000",
        },
      ],
    });
    await client.search([
      { indexName: "vehicles", params: { query: "civic" } },
      { indexName: "vehicles" },
    ]);
    expect(calls).toEqual([
      {
        requests: [
          {
            indexName: "vehicles",
            query: "civic",
            filters: filter ? `year >= 2000 AND ${filter}` : "year >= 2000",
          },
          {
            indexName: "vehicles",
            type: "facet",
            facet: "make",
            query: "",
            ...(filter && { filters: filter }),
          },
          {
            indexName: "vehicles",
            params: filter
              ? `query=civic&filters=${encodeURIComponent(`year >= 2000 AND ${filter}`)}`
              : "query=civic&filters=year%20%3E%3D%202000",
          },
        ],
      },
      filter
        ? [
            {
              indexName: "vehicles",
              params: { query: "civic", filters: filter },
            },
            { indexName: "vehicles", params: { filters: filter } },
          ]
        : [
            { indexName: "vehicles", params: { query: "civic" } },
            { indexName: "vehicles" },
          ],
    ]);
  });
});
