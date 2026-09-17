import type { Effect } from "effect";
import type { Location, Row52Location } from "~/lib/types";
import { Yard } from "~/lib/yard";
import { pypYardWebsite } from "~/lib/yard-website";
import type { AutorecyclerOrgGeo } from "./autorecycler-transform";
import type { GopullitLocation } from "./gopullit-transform";
import { normalizeRegion } from "./normalization";
import type { PullapartLocation } from "./pullapart-client";
import type {
  TapInventoryStoreConfig,
  TapInventorySiteConfig,
} from "./tap-inventory-client";
import type { PullNSaveYard } from "./pullnsave-config";

export type OnYards = (yards: Yard[]) => Effect.Effect<void>;

const unknownContact = {
  operator: null,
  address: null,
  postalCode: null,
  websiteUrl: null,
  phone: null,
  email: null,
};

export function pypYard(location: Location): Yard {
  return {
    ...unknownContact,
    source: "pyp",
    code: location.locationCode,
    name: /pick your part/i.test(location.name)
      ? location.name
      : `LKQ Pick Your Part - ${location.name}`,
    operator: "LKQ Pick Your Part",
    address: location.address,
    city: location.city,
    state: location.stateAbbr,
    postalCode: location.zip,
    ...Yard.coordinates(location.lat, location.lng),
    websiteUrl:
      pypYardWebsite(location.locationPageURL, location.locationCode) ??
      pypYardWebsite(location.urls.store, location.locationCode),
    phone: location.phone,
  };
}

export function pullapartYard(location: PullapartLocation): Yard {
  const operator = location.siteTypeID === 5 ? "U-Pull-&-Pay" : "Pull-A-Part";
  return {
    ...unknownContact,
    source: "pullapart",
    code: String(location.locationID),
    name: /pull[\s-]*a[\s-]*part|u[\s-]*pull/i.test(location.locationName)
      ? location.locationName
      : `${operator} - ${location.locationName}`,
    operator,
    address: [location.address1, location.address2].filter(Boolean).join(", "),
    city: location.cityName,
    state: normalizeRegion(location.stateName, null).stateAbbr,
    postalCode: location.zipCode,
    // The inventory API only resolves ZIP centroids. These are not yard coordinates.
    lat: null,
    lng: null,
    phone: location.phone,
    // The API's email/retailEmail fields are not documented public contacts.
  };
}

export function row52Yards(locations: readonly Row52Location[]): Yard[] {
  const yards = locations.map(
    (location): Yard => ({
      ...unknownContact,
      source: "row52",
      code: String(location.id),
      name: location.name,
      address: [location.address1, location.address2]
        .filter(Boolean)
        .join(", "),
      city: location.city,
      state: location.state?.abbreviation ?? "",
      postalCode: location.zipCode,
      ...Yard.coordinates(location.latitude, location.longitude),
      websiteUrl: Yard.website(location.webUrl),
      phone: location.phone,
    }),
  );
  const websiteCounts = new Map<string, number>();
  for (const yard of yards) {
    if (yard.websiteUrl)
      websiteCounts.set(
        yard.websiteUrl,
        (websiteCounts.get(yard.websiteUrl) ?? 0) + 1,
      );
  }
  return yards.map((yard) => ({
    ...yard,
    websiteUrl:
      yard.websiteUrl && websiteCounts.get(yard.websiteUrl) === 1
        ? yard.websiteUrl
        : null,
  }));
}

export function autorecyclerYard(
  geo: AutorecyclerOrgGeo,
  websiteUrl: string | null = null,
): Yard {
  return {
    ...unknownContact,
    source: "autorecycler",
    code: geo.orgLookup,
    websiteUrl: Yard.website(websiteUrl),
    name: geo.locationName,
    address: geo.address ?? null,
    city: geo.locationCity,
    state: geo.stateAbbr,
    ...Yard.coordinates(geo.lat, geo.lng),
  };
}

export function tapYard(
  store: TapInventoryStoreConfig,
  site: TapInventorySiteConfig,
): Yard {
  return {
    ...unknownContact,
    source: site.source,
    code: store.code,
    name: store.locationName,
    operator: site.siteName,
    address: store.address,
    city: store.city,
    state: store.stateAbbr,
    postalCode: store.zipCode,
    phone: store.phone,
    ...Yard.coordinates(store.lat, store.lng),
  };
}

export function pullnsaveYard(yard: PullNSaveYard): Yard {
  return {
    ...unknownContact,
    source: "pullnsave",
    code: yard.code,
    name: yard.locationName,
    operator: "Pull-N-Save",
    address: yard.address,
    city: yard.city,
    state: yard.stateAbbr,
    postalCode: yard.zipCode,
    ...Yard.coordinates(yard.lat, yard.lng),
  };
}

export function gopullitYard(location: GopullitLocation): Yard {
  return {
    ...unknownContact,
    source: "gopullit",
    code: location.code,
    name: location.locationName,
    operator: "GO Pull-It",
    city: location.city,
    state: location.stateAbbr,
    ...Yard.coordinates(location.lat, location.lng),
  };
}

export const upullitDavieYard = {
  ...unknownContact,
  source: "upullitdavie",
  code: "UPULLIT-DAVIE",
  name: "U Pull It Davie",
  operator: "U Pull It Davie",
  city: "Davie",
  state: "FL",
  lat: 26.0696,
  lng: -80.2437,
  websiteUrl: "https://upullitdavie.com/",
} satisfies Yard;
