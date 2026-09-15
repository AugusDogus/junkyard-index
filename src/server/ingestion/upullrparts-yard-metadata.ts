import type { Yard } from "~/lib/yard";

export type UpullRPartsYard = Omit<Yard, "source"> & { source: "upullrparts" };

// Public contact details and map pins verified 2026-09-15. See the runbook
// for provenance, including the conflicting Rosemount contact-page address.
export const UPULLRPARTS_YARDS: readonly UpullRPartsYard[] = [
  {
    source: "upullrparts",
    code: "UPRRP-1",
    name: "U Pull R Parts - Rosemount",
    operator: "U Pull R Parts",
    address: "2985 160th St W",
    city: "Rosemount",
    state: "MN",
    postalCode: "55068",
    lat: 44.7183045,
    lng: -93.1261146,
    websiteUrl: "https://upullrparts.com/contact/",
    phone: "651-322-1800",
    email: null,
  },
  {
    source: "upullrparts",
    code: "UPRRP-2",
    name: "U Pull R Parts - East Bethel",
    operator: "U Pull R Parts",
    address: "20418 Highway 65 NE",
    city: "East Bethel",
    state: "MN",
    postalCode: "55011",
    lat: 45.3397588,
    lng: -93.2380204,
    websiteUrl: "https://upullrparts.com/contact/",
    phone: "763-434-5229",
    email: null,
  },
  {
    source: "upullrparts",
    code: "UPRRP-3",
    name: "U Pull R Parts - Toledo",
    operator: "U Pull R Parts",
    address: "5650 N Detroit Ave",
    city: "Toledo",
    state: "OH",
    postalCode: "43612",
    lat: 41.7186651,
    lng: -83.5355032,
    websiteUrl: "https://upullrparts.com/contact/",
    phone: "419-724-5503",
    email: null,
  },
];

export function findUpullRPartsYard(store: number) {
  return UPULLRPARTS_YARDS.find((yard) => yard.code === `UPRRP-${store}`);
}
