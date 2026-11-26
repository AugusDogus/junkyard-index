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

test("the server's HTML draws every yard as a light static dot, crowded ones small", () => {
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
  const svg = html.match(/<svg class="yard-map-dots".*?<\/svg>/)?.[0] ?? "";
  const paths = svg.match(/<path[^>]*>/g) ?? [];
  const dots = (path: string | undefined) => path?.match(/M/g)?.length ?? 0;
  expect(paths).toHaveLength(4);
  // A paper halo under the ink, for the crowded and then the clear yards.
  expect(paths.map((path) => path.match(/class="([^"]*)"/)?.[1])).toEqual([
    "yard-map-dots-halo",
    undefined,
    "yard-map-dots-halo yard-map-dots-clear",
    "yard-map-dots-clear",
  ]);
  expect(paths.map(dots)).toEqual([336, 336, 50, 50]);
  // The interactive pins mount once the map knows its size.
  expect(html).not.toContain('class="yard-map-pin"');
  expect(html).toContain("Use arrow keys to move between yard pins");
});
