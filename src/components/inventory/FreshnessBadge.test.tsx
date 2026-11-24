import { afterEach, beforeEach, expect, setSystemTime, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { FreshnessBadge } from "./FreshnessBadge";

const now = Date.parse("2026-11-18T12:00:00Z");
beforeEach(() => setSystemTime(now));
afterEach(() => setSystemTime());

test("unknown publication is neutral rather than stale", () => {
  const html = renderToStaticMarkup(<FreshnessBadge publishedAt={null} />);
  expect(html).toContain("Update time unknown");
  expect(html).not.toContain("Last checked");
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
  expect(html).not.toContain("Last checked");
});

test("known publication becomes stale after 36 hours and says when it was last checked", () => {
  const html = renderToStaticMarkup(
    <FreshnessBadge publishedAt="2026-11-16T23:59:59Z" />,
  );
  expect(html).toContain("Last checked 1 day ago");
  expect(html).toContain("bg-figure");
  expect(html).not.toContain("bg-signal");

  const older = renderToStaticMarkup(
    <FreshnessBadge publishedAt="2026-11-11T12:00:00Z" />,
  );
  expect(older).toContain("Last checked 7 days ago");
});

test("the 36-hour boundary remains current and coverage is preserved", () => {
  const html = renderToStaticMarkup(
    <FreshnessBadge
      publishedAt="2026-11-17T00:00:00Z"
      coverage={{ current: 2, total: 3 }}
    />,
  );
  expect(html).toContain("Nov 17, 2026");
  expect(html).toContain("(2 of 3 yards current)");
  expect(html).not.toContain("Last checked");
});
