import { describe, expect, test } from "bun:test";
import { HiddenSources } from "./hidden-source";

const meeks = HiddenSources.of(["meeks"]);

describe("HiddenSources", () => {
  test("keeps known sources in registry order, so cache keys are stable", () => {
    expect(HiddenSources.of(["pratt", "meeks", "pratt"]).list).toEqual(
      HiddenSources.of(["meeks", "pratt"]).list,
    );
    expect(HiddenSources.of(["not-a-source", "meeks"]).list).toEqual(["meeks"]);
    expect(HiddenSources.none.list).toEqual([]);
  });

  test("says which sources are hidden and leaves them out of selections", () => {
    expect(HiddenSources.has(meeks, "meeks")).toBe(true);
    expect(HiddenSources.has(meeks, "pyp")).toBe(false);
    expect(HiddenSources.has(HiddenSources.none, "meeks")).toBe(false);
    expect(HiddenSources.shown(meeks, ["pyp", "meeks", "row52"])).toEqual([
      "pyp",
      "row52",
    ]);
  });

  test("unlisted sources are the hidden and retired ones", () => {
    expect(HiddenSources.unlisted(meeks)).toEqual(
      expect.arrayContaining(["meeks", "upullitne", "brandywine"]),
    );
    expect(HiddenSources.unlisted(HiddenSources.none)).not.toContain("meeks");
  });

  test("excludes every hidden source from an Algolia filter", () => {
    expect(HiddenSources.algoliaFilter(HiddenSources.none)).toBeUndefined();
    expect(HiddenSources.algoliaFilter(meeks)).toBe('NOT source:"meeks"');
    expect(
      HiddenSources.algoliaFilter(HiddenSources.of(["meeks", "pratt"])),
    ).toBe('NOT source:"pratt" AND NOT source:"meeks"');
  });

  test("adds the exclusion to a request's own filters", () => {
    const unfiltered: { query: string; filters?: string } = { query: "civic" };
    expect(HiddenSources.exclude(meeks, unfiltered)).toEqual({
      query: "civic",
      filters: 'NOT source:"meeks"',
    });
    expect(
      HiddenSources.exclude(meeks, {
        query: "civic",
        filters: "year >= 2000",
      }),
    ).toEqual({
      query: "civic",
      filters: 'year >= 2000 AND NOT source:"meeks"',
    });
    expect(HiddenSources.exclude(HiddenSources.none, unfiltered)).toBe(
      unfiltered,
    );
  });

  test("filters every request of a search, in every request shape", () => {
    const filter = 'NOT source:"meeks"';
    expect(
      HiddenSources.excludeFromSearch(meeks, {
        requests: [
          { indexName: "vehicles", query: "civic", filters: "year >= 2000" },
          { indexName: "vehicles", type: "facet", facet: "make", query: "" },
          {
            indexName: "vehicles",
            params: "query=civic&filters=year%20%3E%3D%202000",
          },
        ],
      }),
    ).toEqual({
      requests: [
        {
          indexName: "vehicles",
          query: "civic",
          filters: `year >= 2000 AND ${filter}`,
        },
        {
          indexName: "vehicles",
          type: "facet",
          facet: "make",
          query: "",
          filters: filter,
        },
        {
          indexName: "vehicles",
          params: `query=civic&filters=${encodeURIComponent(`year >= 2000 AND ${filter}`)}`,
        },
      ],
    });
    expect(
      HiddenSources.excludeFromSearch(meeks, [
        { indexName: "vehicles", params: { query: "civic" } },
        { indexName: "vehicles" },
      ]),
    ).toEqual([
      { indexName: "vehicles", params: { query: "civic", filters: filter } },
      { indexName: "vehicles", params: { filters: filter } },
    ]);
    const search = { requests: [{ indexName: "vehicles", query: "civic" }] };
    expect(HiddenSources.excludeFromSearch(HiddenSources.none, search)).toBe(
      search,
    );
  });
});
