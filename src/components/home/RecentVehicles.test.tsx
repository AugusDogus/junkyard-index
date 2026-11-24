import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { RecentVehicles } from "./RecentVehicles";

const vehicle = {
  year: 2004,
  make: "Honda",
  model: "Civic",
  source: "upullrparts",
  locationCode: "UPRRP-1",
  city: "Omaha",
  state: "NE",
  imageUrl: null,
  indexedAt: "2026-11-20T12:00:00.000Z",
};

test("labels a homepage arrival from a stale yard with when it was last checked, and leaves current ones bare", () => {
  const html = renderToStaticMarkup(
    <RecentVehicles
      vehicles={[
        { ...vehicle, lastChecked: "Last checked 3 days ago" },
        { ...vehicle, model: "Accord", lastChecked: null },
      ]}
    />,
  );
  expect(html.match(/Last checked 3 days ago/g)?.length).toBe(1);
  expect(html).toContain("2004 Honda Accord");
});
