import { useEffect } from "react";
import YardMapCanvas from "~/components/home/YardMapCanvas";
import type { MapYard } from "~/components/home/yard-map-data";
import { getYardDetails } from "~/lib/yard-details";

/** The container the map really gets; the server always guesses 900 x 400. */
export type YardMapFixtureProps = {
  width: number;
  height: number;
};

const places = [
  { code: "anchorage", city: "Anchorage", state: "AK", lat: 61.2, lng: -149.9 },
  { code: "honolulu", city: "Honolulu", state: "HI", lat: 21.3, lng: -157.8 },
  { code: "maine", city: "Waterville", state: "ME", lat: 44.34, lng: -69.66 },
  { code: "miami", city: "Miami", state: "FL", lat: 25.8, lng: -80.2 },
  { code: "sandiego", city: "San Diego", state: "CA", lat: 32.7, lng: -117.1 },
  { code: "seattle", city: "Seattle", state: "WA", lat: 47.6, lng: -122.3 },
  { code: "edmonton", city: "Edmonton", state: "AB", lat: 53.57, lng: -113.65 },
];

const yards: MapYard[] = places.map((place) => {
  const yard = {
    source: "pyp",
    name: `Yard ${place.city}`,
    vehicleCount: 10,
    ...place,
  };
  return { ...yard, ...getYardDetails(yard, null), path: null };
});

export function YardMapFixture({ width, height }: YardMapFixtureProps) {
  // Runs after the map's layout effect has measured its real size.
  useEffect(() => {
    document.body.dataset.hydrated = "";
  }, []);
  return (
    <div style={{ width, height }}>
      <YardMapCanvas yards={yards} selection={null} onSelect={() => {}} />
    </div>
  );
}
