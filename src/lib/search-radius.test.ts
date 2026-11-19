import { expect, test } from "bun:test";
import { SearchRadius } from "./search-radius";

test("only supported positive mile radii become Algolia meters", () => {
  expect(SearchRadius.meters(SearchRadius.parse("50"))).toBe(80467);
  expect(SearchRadius.meters(SearchRadius.parse("250"))).toBe(402336);
  for (const value of [
    null,
    undefined,
    "all",
    "-50",
    "50junk",
    "0",
    "100000",
    Infinity,
  ]) {
    expect(SearchRadius.meters(SearchRadius.parse(value))).toBe("all");
  }
});
