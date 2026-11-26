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

/**
 * The open yard and how the map brings it into view: `zoom` in close (picked
 * from the directory or a shared link), `center` at the current zoom (picked
 * on the map), or `keep` the view (restored with its view after Back).
 */
export type YardMapSelection = {
  yard: MapYard;
  focus: "zoom" | "center" | "keep";
};

/**
 * What the panel beside the map shows: one yard's card, or a short list of
 * the yards under a tap on stacked dots, to pick one from.
 */
export type YardMapPanel =
  | { kind: "yard"; selection: YardMapSelection }
  | { kind: "choice"; yards: MapYard[] };

/** The homepage's map strip, or the taller map on the /map page. */
export type YardMapLayout = "home" | "page";

/** Each layout's height classes, in globals.css, for the map and its frame. */
export const yardMapLayoutClasses = {
  home: { layout: "homepage-map-layout", canvas: "homepage-map-canvas" },
  page: { layout: "map-page-layout", canvas: "map-page-canvas" },
} as const satisfies Record<YardMapLayout, { layout: string; canvas: string }>;
