import { expect, test } from "bun:test";
import robots from "./robots";
import sitemap from "./sitemap";

test("crawlers may fetch /search but not its parameterized searches", () => {
  const rules = [robots().rules].flat();
  const disallowed = rules.flatMap((rule) => [rule.disallow ?? []].flat());
  expect(disallowed).toContain("/search?");
  expect(disallowed).not.toContain("/search");
});

test("the sitemap lists landing pages but not /search", () => {
  const paths = sitemap().map((entry) => new URL(entry.url).pathname);
  expect(paths).not.toContain("/search");
  expect(paths).toEqual(expect.arrayContaining(["/junkyards", "/cars"]));
});
