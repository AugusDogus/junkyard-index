import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { YardMapTile, YardMapTilesReady } from "./YardMapTile";

test.each([
  { key: "2-4-3", images: 4 },
  { key: "unknown", images: 1 },
])("map tiles leave hero resources ahead of $key", ({ key, images }) => {
  const url = "https://tile.openstreetmap.org/3/2/4.png";
  const html = renderToStaticMarkup(
    <YardMapTilesReady.Provider value={true}>
      <YardMapTile
        tile={{
          key,
          url,
          srcSet: "",
          left: 0,
          top: 0,
          width: 256,
          height: 256,
          active: true,
        }}
        tileLoaded={() => {}}
      />
    </YardMapTilesReady.Provider>,
  );
  const tiles = html.match(/<img[^>]*>/g) ?? [];
  expect(tiles).toHaveLength(images);
  expect(tiles.every((tile) => tile.includes('fetchPriority="low"'))).toBe(
    true,
  );
  expect(tiles.every((tile) => tile.includes(`src="${url}"`))).toBe(true);
  expect(html).not.toContain('as="image"');
});

test.each(["2-4-3", "unknown"])(
  "map tile %s waits for the hero paint before requesting images",
  (key) => {
    const html = renderToStaticMarkup(
      <YardMapTilesReady.Provider value={false}>
        <YardMapTile
          tile={{
            key,
            url: "https://tile.openstreetmap.org/3/2/4.png",
            srcSet: "",
            left: 0,
            top: 0,
            width: 256,
            height: 256,
            active: true,
          }}
          tileLoaded={() => {}}
        />
      </YardMapTilesReady.Provider>,
    );
    expect(html).toContain("<img");
    expect(html).toContain('width="256"');
    expect(html).not.toContain("src=");
    expect(html).not.toContain("srcSet=");
    expect(html).not.toContain('as="image"');
    expect(html).toContain("visibility:hidden");
  },
);
