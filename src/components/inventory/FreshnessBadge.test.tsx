import { afterEach, beforeEach, expect, setSystemTime, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { FreshnessBadge } from "./FreshnessBadge";

const now = Date.parse("2026-11-18T12:00:00Z");
beforeEach(() => setSystemTime(now));
afterEach(() => setSystemTime());

test("unknown publication is neutral rather than stale", () => {
  const html = renderToStaticMarkup(<FreshnessBadge publishedAt={null} />);
  expect(html).toContain("Update time unknown");
  expect(html).not.toContain("Not updated");
  expect(html).not.toContain("bg-figure");
  expect(html).not.toContain("bg-signal");
});

test("recent publication shows its date", () => {
  const html = renderToStaticMarkup(
    <FreshnessBadge publishedAt="2026-11-18T08:00:00Z" />,
  );
  expect(html).toContain("Updated");
  expect(html).toContain('dateTime="2026-11-18T08:00:00Z"');
  expect(html).toContain("Nov 18, 2026");
  expect(html).not.toContain("Not updated");
});

test("known publication becomes stale after three days", () => {
  const html = renderToStaticMarkup(
    <FreshnessBadge publishedAt="2026-11-15T11:59:59Z" />,
  );
  expect(html).toContain("Not updated in the last 3 days");
  expect(html).toContain("bg-figure");
  expect(html).not.toContain("bg-signal");
});

test("a source crawled every third day stays current for its five-day look-back", () => {
  const day = 24 * 60 * 60 * 1000;
  const current = renderToStaticMarkup(
    <FreshnessBadge
      publishedAt="2026-11-14T12:00:00Z"
      staleAfterMs={5 * day}
    />,
  );
  expect(current).toContain("Nov 14, 2026");
  expect(current).not.toContain("Not updated");

  const stale = renderToStaticMarkup(
    <FreshnessBadge
      publishedAt="2026-11-13T11:59:59Z"
      staleAfterMs={5 * day}
    />,
  );
  expect(stale).toContain("Not updated in the last 5 days");
});

test("the three-day boundary remains current and coverage is preserved", () => {
  const html = renderToStaticMarkup(
    <FreshnessBadge
      publishedAt="2026-11-15T12:00:00Z"
      coverage={{ current: 2, total: 3 }}
    />,
  );
  expect(html).toContain("Nov 15, 2026");
  expect(html).toContain("(2 of 3 yards current)");
  expect(html).not.toContain("Not updated");
});
