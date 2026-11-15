import type { Yard } from "~/lib/yard";

// Census Public_AR_Current street-address matches captured November 15, 2026.
export const HOLLANDERSTORES_YARDS = [
  {
    source: "hollanderstores",
    code: "leblancsauto",
    tenant: "4573",
    name: "LeBlanc's Auto",
    logo: "LeBlanc's Auto",
    operator: "LeBlanc's Auto",
    address: "37 Willow Rd",
    city: "Bennington",
    state: "VT",
    postalCode: "05201",
    phone: "802-442-2308",
    email: null,
    lat: 42.914677329593,
    lng: -73.188332856971,
    websiteUrl: "https://leblancsauto.hollanderstores.com/",
    minimum: 450,
  },
  {
    source: "hollanderstores",
    code: "blvdautoparts",
    tenant: "8069",
    name: "Monster Junkyard",
    logo: "Monster Junkyard",
    operator: "Monster Junkyard",
    address: "1745 Page Blvd",
    city: "Springfield",
    state: "MA",
    postalCode: "01104",
    phone: "413-543-3317",
    email: null,
    lat: 42.149493339132,
    lng: -72.522477501396,
    websiteUrl: "https://blvdautoparts.hollanderstores.com/",
    minimum: 65,
  },
  {
    source: "hollanderstores",
    code: "standardauto",
    tenant: "2329",
    name: "Standard Used Auto Parts & Wrecking",
    logo: "Standard Auto Parts",
    operator: "Standard Used Auto Parts & Wrecking",
    address: "257 Granite St",
    city: "Worcester",
    state: "MA",
    postalCode: "01607",
    phone: "508-755-8631",
    email: null,
    lat: 42.23577481503,
    lng: -71.782114427868,
    websiteUrl: "https://standardauto.hollanderstores.com/",
    minimum: 65,
  },
  {
    source: "hollanderstores",
    code: "petrillosauto",
    tenant: "1975",
    name: "Petrillo's Used Auto Parts",
    logo: "Petrillos Auto Parts",
    operator: "Petrillo's Used Auto Parts",
    address: "150 Middletown Ave",
    city: "New Haven",
    state: "CT",
    postalCode: "06513",
    phone: "203-865-5766",
    email: null,
    lat: 41.323233531351,
    lng: -72.886238222811,
    websiteUrl: "https://petrillosauto.hollanderstores.com/",
    minimum: 45,
  },
  {
    source: "hollanderstores",
    code: "kirchhaynautopa",
    tenant: "6549",
    name: "Kirchhayn Auto Parts",
    logo: "Kirchhayn Auto Parts",
    operator: "Kirchhayn Auto Parts",
    address: "W4726 County Road A",
    city: "Fredonia",
    state: "WI",
    postalCode: "53021",
    phone: "262-692-2447",
    email: null,
    lat: 43.469140113527,
    lng: -88.022746168222,
    websiteUrl: "https://kirchhaynautopa.hollanderstores.com/",
    minimum: 90,
  },
] as const satisfies readonly (Yard & {
  tenant: string;
  logo: string;
  minimum: number;
})[];
export type HollanderstoresYard = (typeof HOLLANDERSTORES_YARDS)[number];

export function hollanderstoresDestination(
  raw: string,
  yard: HollanderstoresYard,
): boolean {
  const url = URL.parse(raw);
  return (
    url !== null &&
    url.origin === new URL(yard.websiteUrl).origin &&
    !url.username &&
    !url.password &&
    !url.search &&
    !url.hash &&
    new RegExp(`^/VehicleDealerShowParts/${yard.tenant}/[1-9][0-9]*$`).test(
      url.pathname,
    )
  );
}
