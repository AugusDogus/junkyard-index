import { expect, test } from "bun:test";
import { shardTimingsFiles, verifyTestShards } from "./verify-test-shards";

test("shard timings parsing returns recorded files and rejects other shapes", () => {
  expect(
    shardTimingsFiles(
      { version: 1, files: { "a.test.ts": 12, "b.test.ts": 0 } },
      "s1/timings.json",
    ),
  ).toEqual(["a.test.ts", "b.test.ts"]);
  for (const value of [
    null,
    [],
    { files: {} },
    { version: 2, files: {} },
    { version: 1, files: [] },
    { version: 1, files: { "a.test.ts": -1 } },
    { version: 1, files: { "a.test.ts": "12" } },
    { version: 1, files: { "a.test.ts": Number.POSITIVE_INFINITY } },
  ])
    expect(() => shardTimingsFiles(value, "s1/timings.json")).toThrow(
      "s1/timings.json is not a Bun version 1 timings manifest",
    );
});

test("shard verification accepts an exact partition including newly discovered files", () => {
  expect(() =>
    verifyTestShards(
      ["a.test.ts", "new.test.ts"],
      [["new.test.ts"], ["a.test.ts"]],
    ),
  ).not.toThrow();
});

test("shard verification rejects missing, duplicate and unexpected files", () => {
  expect(() =>
    verifyTestShards(["a.test.ts", "new.test.ts"], [["a.test.ts"]]),
  ).toThrow('Missing: ["new.test.ts"]');
  expect(() =>
    verifyTestShards(["a.test.ts"], [["a.test.ts"], ["a.test.ts"]]),
  ).toThrow('duplicates: [["a.test.ts",2]]');
  expect(() =>
    verifyTestShards(["a.test.ts"], [["a.test.ts", "other.test.ts"]]),
  ).toThrow('unexpected: ["other.test.ts"]');
});
