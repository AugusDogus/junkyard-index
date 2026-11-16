import type { Yard } from "~/lib/yard";
export const HARRYS_ORIGIN = "https://wegotused.com";
export const HARRYS_CATALOG = HARRYS_ORIGIN + "/our-inventory/";
export const HARRYS_OWNER = HARRYS_ORIGIN + "/contact/";
export const HARRYS_PAGE_SIZE = 15;
export const HARRYS_MAX_PAGES = 500;
export const HARRYS_MINIMUM = 3_500;
export type HarrysYard = Omit<Yard, "source" | "lat" | "lng"> & {
  source: "harrys";
  lat: number;
  lng: number;
};
// Address and phone: official contact page. Coordinates: saved Census receipts.
export const HARRYS_YARDS = [
  {
    source: "harrys",
    code: "allentown",
    name: "Harry's U-Pull It Allentown",
    operator: "Harry's U-Pull It",
    address: "1510 East Jonathan Street",
    city: "Allentown",
    state: "PA",
    postalCode: null,
    phone: "610-433-9901",
    email: null,
    lat: 40.631513622519,
    lng: -75.434136996739,
    websiteUrl: HARRYS_ORIGIN + "/",
  },
  {
    source: "harrys",
    code: "hazle-township",
    name: "Harry's U-Pull It Hazle Township",
    operator: "Harry's U-Pull It",
    address: "1010 Winters Avenue",
    city: "Hazle Township",
    state: "PA",
    postalCode: "18202",
    phone: "570-459-9901",
    email: null,
    lat: 40.95642495259,
    lng: -76.011302055883,
    websiteUrl: HARRYS_ORIGIN + "/",
  },
  {
    source: "harrys",
    code: "pennsburg",
    name: "Harry's U-Pull It Pennsburg",
    operator: "Harry's U-Pull It",
    address: "2557 Geryville Pike",
    city: "Pennsburg",
    state: "PA",
    postalCode: "18073",
    phone: "215-541-9950",
    email: null,
    lat: 40.381185778706,
    lng: -75.46222132057,
    websiteUrl: HARRYS_ORIGIN + "/",
  },
] as const satisfies readonly HarrysYard[];
export const HARRYS_YARD_MINIMUM = 500;
export const HARRYS_MINIMUM_BY_YARD: ReadonlyMap<string, number> = new Map(
  HARRYS_YARDS.map((yard) => [yard.code, HARRYS_YARD_MINIMUM]),
);
export function harrysPageUrl(index: number): string {
  if (!Number.isInteger(index) || index < 0 || index >= HARRYS_MAX_PAGES)
    throw new Error("Harry's page is outside the bounded native inventory");
  return (
    HARRYS_CATALOG +
    "?inv[yard]=all&inv[make]=&inv[model]=&inv[manufacturer]=&inv[year]=&inv[part]=&inv[page]=" +
    index +
    "&inv[sort][yard_date]=0&inv[sort][yard_city]=1"
  );
}
