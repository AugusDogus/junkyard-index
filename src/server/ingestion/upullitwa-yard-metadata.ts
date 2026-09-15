import { Yard } from "~/lib/yard";

export type UpullitwaYard = Yard & { source: "upullitwa" };
export type LocatedUpullitwaYard = UpullitwaYard & { lat: number; lng: number };

// Public contact blocks at https://go2upullit.com/, verified 2026-09-15.
// Coordinates are place pins (!3d/!4d), not map viewport centers, from the
// linked maps.app.goo.gl URLs: cW7pLRgwmcGDFcSy5, 7aVFMCbMYFW3SXKJ8,
// 89zx5B2DajXoRXEc7 for Pasco, Yakima, Kennewick respectively.
const locations = [
  {
    code: "JJ65",
    city: "Pasco",
    address: "802 S Oregon Ave.",
    postalCode: "99301",
    phone: "509-792-1452",
    lat: 46.2260409,
    lng: -119.0768228,
  },
  {
    code: "UU43",
    city: "Yakima",
    address: "14 E Washington Ave.",
    postalCode: "98903",
    phone: "509-895-7655",
    lat: 46.5700594,
    lng: -120.4894576,
  },
  {
    code: "UU44",
    city: "Kennewick",
    address: "34508 S Piert Rd",
    postalCode: "99337",
    phone: "509-240-9170",
    lat: 46.1594402,
    lng: -119.0136698,
  },
];

export const UPULLITWA_YARDS: readonly UpullitwaYard[] = locations.map(
  (location) => ({
    ...location,
    ...Yard.coordinates(location.lat, location.lng),
    source: "upullitwa",
    name: `U-Pull-It Auto Parts - ${location.city}`,
    operator: "U-Pull-It Auto Parts",
    state: "WA",
    websiteUrl: Yard.website("https://go2upullit.com/"),
    email: null,
  }),
);

export function upullitwaYard(id: string): LocatedUpullitwaYard | null {
  const yard = UPULLITWA_YARDS.find((candidate) => candidate.code === id);
  return yard && yard.lat !== null && yard.lng !== null
    ? { ...yard, lat: yard.lat, lng: yard.lng }
    : null;
}
