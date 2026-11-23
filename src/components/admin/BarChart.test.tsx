import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { BarChart } from "./BarChart";

test("draws bars scaled to the highest value and lists every point in its table", () => {
  const html = renderToStaticMarkup(
    <BarChart
      title="Credits used per day"
      data={[
        { day: "2026-11-21", value: 50 },
        { day: "2026-11-22", value: 200 },
      ]}
    />,
  );
  expect(html).toContain("Highest: 200");
  expect(html).toContain("height:25%");
  expect(html).toContain("height:100%");
  expect(html).toContain("Nov 21: 50");
  expect(html).toMatch(/<td[^>]*>Nov 22<\/td><td[^>]*>200<\/td>/);
});

test("says so instead of drawing empty bars when every value is 0", () => {
  const html = renderToStaticMarkup(
    <BarChart title="Emails" data={[{ day: "2026-11-22", value: 0 }]} />,
  );
  expect(html).toContain("None in this period");
  expect(html).not.toContain("height:");
});
