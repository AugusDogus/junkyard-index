import { describe, expect, test } from "bun:test";
import { Map } from "pigeon-maps";
import { renderToStaticMarkup } from "react-dom/server";
import { YardMapTile } from "~/components/home/YardMapTile";
import type { YardMapView } from "./yard-map-projection";
import { getYardMapTileUrls, yardTileProvider } from "./yard-map-tiles";

describe("yard map destination tiles", () => {
  const views: YardMapView[] = [
    { center: [39, -98], zoom: 3.4 },
    { center: [32.5, -117], zoom: 9 },
    { center: [85, 179], zoom: 1 },
  ];

  for (const view of views) {
    for (const highDensity of [false, true]) {
      test(`matches rendered tiles at zoom ${view.zoom}, high density ${highDensity}`, () => {
        const width = 713;
        const height = 317;
        const html = renderToStaticMarkup(
          <Map
            center={view.center}
            zoom={view.zoom}
            width={width}
            height={height}
            provider={yardTileProvider}
            tileComponent={YardMapTile}
            attribution={false}
          />,
        );
        const pattern = highDensity
          ? /<source\b[^>]*srcSet="([^"]+)"/g
          : /<img\b[^>]*src="([^"]+)"/g;
        const rendered = new Set(
          [...html.matchAll(pattern)]
            .map((match) => match[1])
            .filter((url) => typeof url === "string"),
        );
        expect(rendered.size).toBeGreaterThan(0);
        expect(
          new Set(getYardMapTileUrls(view, width, height, highDensity)),
        ).toEqual(rendered);
      });
    }
  }
});
