import { YardMapMarker } from "~/lib/yard-map-marker";
import type { YardMapView } from "~/lib/yard-map-projection";
import type { MapYard } from "./yard-map-data";
import { yardMapPinOffset } from "./YardMapPinLayer";

/**
 * Every yard as a plain dot in the pin layer, laid out for `view`: the
 * markers in the server's HTML, and until the marker canvas first draws.
 * Each dot is a zero-length round-capped stroke in one of four paths (paper
 * halo, then ink; crowded, then clear), so the page gains four elements, not
 * one per yard: a circle per yard, sized against the fit scale, cost a style
 * pass per yard on first layout.
 */
export function YardMapStaticDots({
  pins,
  view,
}: {
  pins: readonly MapYard[];
  view: YardMapView;
}) {
  const sizes = YardMapMarker.sizes(pins, view.zoom);
  const path = (crowded: boolean) =>
    pins
      .filter((_, index) => (sizes[index] === "dot") === crowded)
      .map((yard) => {
        const { x, y } = yardMapPinOffset(yard, view);
        return `M${Math.round(x)} ${Math.round(y)}h0`;
      })
      .join("");
  const crowded = path(true);
  const clear = path(false);
  // Clear dots overlap nothing, so drawing them after the crowded ones keeps
  // every overlap in the canvas's order.
  return (
    <svg className="yard-map-dots" aria-hidden="true" width="1" height="1">
      <path className="yard-map-dots-halo" d={crowded} />
      <path d={crowded} />
      <path className="yard-map-dots-halo yard-map-dots-clear" d={clear} />
      <path className="yard-map-dots-clear" d={clear} />
    </svg>
  );
}
