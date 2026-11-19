import type { HomepageYard } from "~/lib/homepage-inventory";

/** Only the fields used by the map, directory, and selected-yard details. */
export type MapYard = Pick<
  HomepageYard,
  | "source"
  | "code"
  | "name"
  | "city"
  | "state"
  | "lat"
  | "lng"
  | "vehicleCount"
  | "address"
  | "phone"
  | "email"
  | "mapsUrl"
> & {
  path: { href: string } | null;
  website: { href: string; kind: "provider" | "yard" } | null;
};

export const MapYard = {
  from(yard: HomepageYard): MapYard {
    return {
      source: yard.source,
      code: yard.code,
      name: yard.name,
      city: yard.city,
      state: yard.state,
      lat: yard.lat,
      lng: yard.lng,
      vehicleCount: yard.vehicleCount,
      address: yard.address,
      phone: yard.phone,
      email: yard.email,
      mapsUrl: yard.mapsUrl,
      path: yard.path ? { href: yard.path.href } : null,
      website: yard.website
        ? { href: yard.website.href, kind: yard.website.kind }
        : null,
    };
  },
} as const;
