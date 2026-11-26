import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { createRoot } from "react-dom/client";
import { YardMap } from "~/components/home/YardMap";
import type { MapYard } from "~/components/home/yard-map-data";

const router = {
  back() {},
  forward() {},
  refresh() {},
  hmrRefresh() {},
  push() {},
  replace() {},
  async prefetch() {},
};

// Yards along a line of longitude, so a location in the south reverses the
// default north-first order.
const yards: MapYard[] = Array.from({ length: 40 }, (_, index) => ({
  source: "pyp",
  code: String(index),
  name: `Yard ${index}`,
  city: "Town",
  state: "TX",
  lat: 45 - index * 0.5,
  lng: -97,
  vehicleCount: 100 + index,
  address: null,
  phone: null,
  email: null,
  mapsUrl: `https://maps.example.test/${index}`,
  path: null,
  website: null,
}));

createRoot(document.body).render(
  <AppRouterContext.Provider value={router}>
    <YardMap yards={yards} vehicleCount={5000} layout="home" />
  </AppRouterContext.Provider>,
);
