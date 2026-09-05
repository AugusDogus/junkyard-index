import type { TileComponentProps } from "pigeon-maps";
import { useRef } from "react";

export function yardTileProvider(x: number, y: number, zoom: number) {
  return `https://tile.openstreetmap.org/${zoom}/${x}/${y}.png`;
}

export function YardMapTile({ tile, tileLoaded }: TileComponentProps) {
  const loadedParts = useRef(new Set<number>());
  const [x, y, zoom] = tile.key.split("-").map(Number);
  // Pigeon's tile keys are x-y-zoom. Keep ordinary tiles working if that changes.
  if (
    x === undefined ||
    y === undefined ||
    zoom === undefined ||
    ![x, y, zoom].every(Number.isInteger)
  ) {
    return (
      <img
        src={tile.url}
        width={tile.width}
        height={tile.height}
        alt=""
        onLoad={tileLoaded}
        onError={tileLoaded}
        style={{ position: "absolute", left: tile.left, top: tile.top }}
      />
    );
  }

  // OSM has no @2x endpoint. Four child tiles supply the same area at twice
  // the resolution. On standard screens all four pictures reuse one cached URL.
  return (
    <div
      style={{
        position: "absolute",
        left: tile.left,
        top: tile.top,
        width: tile.width,
        height: tile.height,
      }}
    >
      {[0, 1, 2, 3].map((part) => {
        const column = part % 2;
        const row = Math.floor(part / 2);
        const loaded = () => {
          loadedParts.current.add(part);
          if (loadedParts.current.size === 4) tileLoaded();
        };
        return (
          <div
            key={part}
            className="yard-map-tile-part"
            style={{ left: `${column * 50}%`, top: `${row * 50}%` }}
          >
            <picture>
              <source
                media="(min-resolution: 1.5dppx)"
                srcSet={yardTileProvider(x * 2 + column, y * 2 + row, zoom + 1)}
              />
              <img
                src={tile.url}
                width={256}
                height={256}
                alt=""
                draggable={false}
                decoding="async"
                onLoad={loaded}
                onError={loaded}
                style={{ translate: `${-column * 50}% ${-row * 50}%` }}
              />
            </picture>
          </div>
        );
      })}
    </div>
  );
}
