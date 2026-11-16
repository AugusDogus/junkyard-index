import type { Yard } from "~/lib/yard";

export const BEAVERS_ORIGIN = "https://beaversgarage.hollanderstores.com";
export const BEAVERS_CATALOG = `${BEAVERS_ORIGIN}/VehicleDealerSearch`;
// Current official parts contact and its address-bound native map marker.
// Tenant 503's Mooresville sales address is the same family, independently
// confirmed by the official sales site's About link back to the parts site.
// This is the operator's canonical contact point, not per-donor presence proof.
export const BEAVERS_YARD = {
  source: "beavers",
  code: "kannapolis",
  name: "Beaver's Car Salvage",
  operator: "Beaver's Car Salvage / Beaver's Garage Inc.",
  address: "9455 Smith Road",
  city: "Kannapolis",
  state: "NC",
  postalCode: "28081",
  phone: "704-932-8690",
  email: "sales@beaverscarsalvage.com",
  lat: 35.5465596,
  lng: -80.7017609,
  websiteUrl: "https://www.beaverscarsalvage.com/",
} as const satisfies Omit<Yard, "source"> & { source: "beavers" };
export type BeaversYard = typeof BEAVERS_YARD;
// Complete 290-row census: 278 clean unique donors, 12 missing-make rejects.
export const BEAVERS_MINIMUM_INVENTORY = 92;

export function beaversPage(raw: string): number | null {
  const url = URL.parse(raw);
  if (
    !url ||
    url.origin !== BEAVERS_ORIGIN ||
    url.username ||
    url.password ||
    url.hash ||
    url.pathname !== "/VehicleDealerSearch"
  )
    return null;
  if (!url.search) return 1;
  const match = /^\?page=([1-9]\d*)$/.exec(url.search);
  const page = Number(match?.[1]);
  return match && page <= 100 ? page : null;
}
export function beaversDonorId(
  raw: string,
  kind: "route" | "detail",
): string | null {
  const url = URL.parse(raw);
  if (
    !url ||
    url.origin !== BEAVERS_ORIGIN ||
    url.username ||
    url.password ||
    url.hash ||
    url.search
  )
    return null;
  const prefix =
    kind === "route" ? "VehicleDealerShowParts" : "VehiclePartSearch";
  return (
    new RegExp(`^/${prefix}/503/([1-9]\\d*)$`).exec(url.pathname)?.[1] ?? null
  );
}
export const beaversDetailUrl = (route: string) => {
  const id = beaversDonorId(route, "route");
  if (!id)
    throw new Error(
      "Beaver's donor route lacks its published tenant503 identifier",
    );
  return `${BEAVERS_ORIGIN}/VehiclePartSearch/503/${id}`;
};
