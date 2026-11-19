import { expect, test } from "bun:test";
import { SearchHitsCache } from "./search-hits-cache";

test("retains loaded pages separately for each sort and search", () => {
  const cache = SearchHitsCache.create();
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

test("tab storage restores pages per search and sort without accepting corrupt data", () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
  const state = { index: "vehicles_newest", query: "civic", page: 2 };
  const hits = {
    0: [{ objectID: "one", __position: 1 }],
    1: [{ objectID: "two", __position: 25 }],
    2: [{ objectID: "three", __position: 49 }],
  };
  const original = SearchHitsCache.create();
  original.restore(storage);
  original.write({ state, hits });
  const restored = SearchHitsCache.create();
  restored.restore(storage);
  expect(restored.read({ state: { ...state, page: 0 } })).toEqual(hits);
  expect(
    restored.read({ state: { ...state, filters: "year:2010" } }),
  ).toBeNull();
  expect(
    restored.read({ state: { ...state, index: "vehicles_oldest" } }),
  ).toBeNull();
  const corrupt = SearchHitsCache.create();
  corrupt.restore({
    ...storage,
    getItem: () => '[ ["key", {"hits": {"0": [{"objectID": 7}]}}] ]',
  });
  expect(corrupt.read({ state })).toBeNull();
});
