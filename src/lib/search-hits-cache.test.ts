import { expect, test } from "bun:test";
import { SearchHitsCache } from "./search-hits-cache";

test("retains loaded pages separately for each sort and search", () => {
  const cache = SearchHitsCache.create<{ objectID: string }>();
  const newest = { index: "vehicles_newest", query: "civic", page: 1 };
  const oldest = { ...newest, index: "vehicles_oldest" };
  const newestHits = { 0: [{ objectID: "new", __position: 1 }], 1: [] };
  const oldestHits = { 0: [{ objectID: "old", __position: 1 }] };
  cache.write({ state: newest, hits: newestHits });
  cache.write({ state: oldest, hits: oldestHits });
  expect(cache.read({ state: { ...newest, page: 0 } })).toEqual(newestHits);
  expect(cache.read({ state: oldest })).toEqual(oldestHits);
  expect(cache.read({ state: { ...newest, query: "camry" } })).toBeNull();
  expect(cache.read({ state: { ...newest, filters: "year:2010" } })).toBeNull();
});

test("bounds cache growth while typing", () => {
  const cache = SearchHitsCache.create();
  for (let i = 0; i < 20; i++) {
    cache.write({ state: { query: String(i) }, hits: {} });
  }
  expect(cache.read({ state: { query: "0" } })).toBeNull();
  expect(cache.read({ state: { query: "19" } })).toEqual({});
});
