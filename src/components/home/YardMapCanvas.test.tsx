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

test("every yard keeps its own marker, crowded ones as dots, with one Tab stop", () => {
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
      onChoose={() => {}}
    />,
  );
  const markers = html.match(/<button[^>]*class="yard-map-pin"[^>]*>/g) ?? [];
  expect(markers).toHaveLength(386);
  expect(
    markers.filter((marker) => marker.includes('tabindex="0"')),
  ).toHaveLength(1);
  expect(
    markers.filter((marker) => marker.includes('tabindex="-1"')),
  ).toHaveLength(385);
  expect(
    markers.filter((marker) => marker.includes('data-size="dot"')),
  ).toHaveLength(336);
  expect(
    markers.filter((marker) => marker.includes('data-size="pin"')),
  ).toHaveLength(50);
  expect(html).toContain("Use arrow keys to move between yard pins");
});
