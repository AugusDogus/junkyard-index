import { afterEach, beforeEach, expect, setSystemTime, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { AdminTime } from "./AdminTime";

beforeEach(() => setSystemTime(Date.parse("2026-11-22T15:00:00Z")));
afterEach(() => setSystemTime());

test("the server render names its time zone, so it is never read as local time", () => {
  const html = renderToStaticMarkup(
    <AdminTime date={new Date("2026-11-22T07:00:00Z")} />,
  );
  expect(html).toContain("Nov 22, 7:00 AM UTC (8 h ago)");
  expect(html).toContain('dateTime="2026-11-22T07:00:00.000Z"');
});

test("a missing time shows its empty text", () => {
  expect(
    renderToStaticMarkup(<AdminTime date={null} empty="None in 14 days" />),
  ).toContain("None in 14 days");
});
