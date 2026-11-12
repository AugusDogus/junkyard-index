import type { TileComponentProps } from "pigeon-maps";
import { useRef, type CSSProperties } from "react";
import { yardTileProvider } from "~/lib/yard-map-tiles";

/**
 * Pigeon lays tiles out from the tile grid's first column, and that column
 * moves when the map adopts its measured size after the server's estimate.
 * Placing each tile with a transform instead of left/top keeps that move out
 * of layout, so the browser does not count it as a layout shift. The picture
 * on screen is the same either way.
 */
function tilePosition(tile: TileComponentProps["tile"]): CSSProperties {
  return {
    position: "absolute",
    left: 0,
    top: 0,
    transform: `translate(${tile.left}px, ${tile.top}px)`,
  };
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
        fetchPriority={tile.active ? "high" : "auto"}
        width={tile.width}
        height={tile.height}
        alt=""
        onLoad={tileLoaded}
        onError={tileLoaded}
        style={tilePosition(tile)}
      />
    );
  }

  // OSM has no @2x endpoint. Four child tiles supply the same area at twice
  // the resolution. On standard screens all four pictures reuse one cached URL.
  return (
    <div
      style={{
        ...tilePosition(tile),
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
                fetchPriority={tile.active ? "high" : "auto"}
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
