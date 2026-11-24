import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { SourceStateBadge } from "./AdminParts";

test("a resting source names its next crawl day instead of a missed update", () => {
  const html = renderToStaticMarkup(
    <SourceStateBadge
      summary={{ state: "resting", nextCrawlDay: "2026-11-23" }}
    />,
  );
  expect(html).toContain("Resting, next crawl Mon, Nov 23");
  expect(html).not.toContain("Not updated yet today");
});

test("a waiting source still says it has not updated today", () => {
  expect(
    renderToStaticMarkup(
      <SourceStateBadge summary={{ state: "waiting", nextCrawlDay: null }} />,
    ),
  ).toContain("Not updated yet today");
});
