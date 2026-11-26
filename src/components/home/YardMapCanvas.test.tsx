import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { getYardDetails } from "~/lib/yard-details";
import YardMapCanvas from "./YardMapCanvas";

const yard = (index: number, lat: number, lng: number) => {
  const yard = {
    source: "pyp",
    code: String(index),
    name: `Yard ${index}`,
    city: "City",
    state: "CA",
    lat,
    lng,
    vehicleCount: 10,
  };
  return { ...yard, ...getYardDetails(yard, null), path: null };
};

test("map markers share one Tab stop and a dense area becomes one group", () => {
  // 50 yards spread across the lower 48, well apart at the overview zoom.
  const spread = Array.from({ length: 50 }, (_, index) =>
    yard(index, 26 + (index % 5) * 4.5, -122 + Math.floor(index / 5) * 6),
  );
  // 336 yards on top of each other, clear of the spread ones.
  const dense = Array.from({ length: 336 }, (_, index) =>
    yard(50 + index, 48.5 + index / 10000, -119),
  );
  const html = renderToStaticMarkup(
    <YardMapCanvas
      yards={[...spread, ...dense]}
      selection={null}
      onSelect={() => {}}
    />,
  );
  const markers =
    html.match(/<button[^>]*class="yard-map-pin[^"]*"[^>]*>/g) ?? [];
  expect(markers).toHaveLength(51);
  expect(
    markers.filter((marker) => marker.includes('tabindex="0"')),
  ).toHaveLength(1);
  expect(
    markers.filter((marker) => marker.includes('tabindex="-1"')),
  ).toHaveLength(50);
  const groups = markers.filter((marker) =>
    marker.includes("yard-map-cluster"),
  );
  expect(groups).toHaveLength(1);
  expect(groups[0]).toContain(
    'aria-label="336 yards in CA. Zoom in to pick one."',
  );
  expect(html).toContain("Use arrow keys to move between yard pins");
});
