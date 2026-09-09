import { Yard } from "./yard";

type InventoryYard = {
  source: string;
  name: string;
  city: string;
  state: string;
  lat: number;
  lng: number;
};

type YardMetadata = Omit<Yard, "source" | "code">;

export function getYardDetails(
  yard: InventoryYard,
  metadata: YardMetadata | null,
) {
  let name = metadata?.name ?? yard.name;
  // Keep legacy inventory readable until its first metadata ingestion.
  if (
    !metadata &&
    yard.source === "pullapart" &&
    !/pull[\s-]*a[\s-]*part|u[\s-]*pull/i.test(name)
  ) {
    name = `Pull-A-Part / U-Pull-&-Pay - ${name}`;
  } else if (
    !metadata &&
    yard.source === "pyp" &&
    !/pick your part/i.test(name)
  ) {
    name = `LKQ Pick Your Part - ${name}`;
  }
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
    websiteUrl: Yard.website(metadata?.websiteUrl ?? null),
    phone: metadata?.phone ?? null,
    email: metadata?.email ?? null,
    mapsUrl: `https://www.google.com/maps/search/?${mapsQuery}`,
  };
}
