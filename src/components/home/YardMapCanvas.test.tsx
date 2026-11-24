import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { getYardDetails } from "~/lib/yard-details";
import YardMapCanvas from "./YardMapCanvas";

test("hundreds of visible map pins share one Tab stop", () => {
  const yards = Array.from({ length: 386 }, (_, index) => {
    const yard = {
      source: "pyp",
      code: String(index),
      name: `Yard ${index}`,
      city: "City",
      state: "CA",
      lat: 34 + index / 10000,
      lng: -118,
      vehicleCount: 10,
    };
    return { ...yard, ...getYardDetails(yard, null), path: null };
  });
  const html = renderToStaticMarkup(
    <YardMapCanvas yards={yards} selected={null} onSelect={() => {}} />,
  );
  const pins = html.match(/<button[^>]*class="yard-map-pin"[^>]*>/g) ?? [];
  expect(pins).toHaveLength(386);
  expect(pins.filter((pin) => pin.includes('tabindex="0"'))).toHaveLength(1);
  expect(pins.filter((pin) => pin.includes('tabindex="-1"'))).toHaveLength(385);
  expect(html).toContain("Use arrow keys to move between yard pins");
});
