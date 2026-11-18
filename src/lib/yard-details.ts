import { YardName } from "./yard-name";
import { Yard } from "./yard";
import { resolveYardWebsite } from "./yard-website";

type InventoryYard = {
  source: string;
  code: string;
  name: string;
  city: string;
  state: string;
  lat: number;
  lng: number;
  inventoryUrl?: string | null;
};

type YardMetadata = Omit<Yard, "source" | "code">;

export function getYardDetails(
  yard: InventoryYard,
  metadata: YardMetadata | null,
) {
  const name = YardName.resolve({
    ...yard,
    name: metadata?.name ?? yard.name,
    city: metadata?.city ?? yard.city,
    operator: metadata?.operator,
  });
  const city = metadata?.city ?? yard.city;
  const state = metadata?.state ?? yard.state;
  const coordinates = Yard.coordinates(
    metadata?.lat ?? null,
    metadata?.lng ?? null,
  );
  const address = metadata?.address ?? null;
  const postalCode = metadata?.postalCode ?? null;
  const mapsQuery = new URLSearchParams({
    api: "1",
    query: [name, address, city, state, postalCode].filter(Boolean).join(", "),
  });
  return {
    name,
    city,
    state,
    lat: coordinates.lat ?? yard.lat,
    lng: coordinates.lng ?? yard.lng,
    operator: metadata?.operator ?? null,
    address,
    postalCode,
    website: resolveYardWebsite({
      ...yard,
      name,
      state,
      operator: metadata?.operator,
      websiteUrl: metadata?.websiteUrl,
    }),
    phone: metadata?.phone ?? null,
    email: metadata?.email ?? null,
    mapsUrl: `https://www.google.com/maps/search/?${mapsQuery}`,
  };
}
