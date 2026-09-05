import { Expand } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "~/components/ui/button";
import type { HomepageYard } from "~/lib/homepage-inventory";
import {
  getYardMapOverview,
  hasMapCoordinates,
  projectYardLocation,
} from "~/lib/yard-map-projection";

export function YardMapOverview({
  yards,
  land,
  loading,
  onSelect,
  onExplore,
}: {
  yards: HomepageYard[];
  land: ReactNode;
  loading: boolean;
  onSelect: (yard: HomepageYard) => void;
  onExplore: () => void;
}) {
  const bounds = getYardMapOverview(yards);

  return (
    <div
      className="yard-map-overview absolute inset-0 overflow-hidden"
      style={{ containerType: "size" }}
      aria-label="Map of indexed junkyard locations"
      aria-busy={loading}
    >
      <div
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2"
        style={{
          width: `min(100cqw, ${(100 * bounds.width) / bounds.height}cqh)`,
          aspectRatio: bounds.width / bounds.height,
        }}
      >
        <svg
          viewBox={`${bounds.left} ${bounds.top} ${bounds.width} ${bounds.height}`}
          className="yard-map-land size-full overflow-visible"
          aria-hidden="true"
        >
          {land}
        </svg>
        {yards.filter(hasMapCoordinates).map((yard) => {
          const point = projectYardLocation(yard);
          return (
            <button
              key={`${yard.source}:${yard.code}`}
              type="button"
              aria-label={`${yard.name}, ${yard.city}, ${yard.state}`}
              title={yard.name}
              onClick={() => onSelect(yard)}
              className="yard-map-pin absolute size-6 -translate-x-1/2 -translate-y-1/2"
              style={{
                left: `${((point.x - bounds.left) / bounds.width) * 100}%`,
                top: `${((point.y - bounds.top) / bounds.height) * 100}%`,
              }}
            />
          );
        })}
      </div>
      <Button
        id="explore-yard-map"
        type="button"
        variant="outline"
        className="bg-background absolute top-3 right-3 shadow-sm"
        onClick={onExplore}
        aria-disabled={loading}
      >
        <Expand aria-hidden="true" />
        {loading ? "Loading map…" : "Explore map"}
      </Button>
    </div>
  );
}
