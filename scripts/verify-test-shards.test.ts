import { expect, test } from "bun:test";
import { verifyTestShards } from "./verify-test-shards";

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
