import { Effect } from "effect";
import { z } from "zod";
import { resolveYardWebsite } from "~/lib/yard-website";
import { normalizeRegion } from "./normalization";
import { fetchProviderText } from "./provider-http-client";
import {
  fetchPullapartLocations,
  type PullapartLocation,
} from "./pullapart-client";
import type { AutorecyclerOrgGeo } from "./autorecycler-transform";
import {
  inventoryHtmlAttribute,
  stripInventoryRawText,
} from "./inventory-html";

const organizationSchema = z.object({
  id_text: z.string().regex(/^pull-a-part(?:[- ][a-z0-9]+)*$/),
  name_text: z.string().regex(/^Pull A Part - .+/i),
  address_city_text: z.string().trim().min(1),
  address_zip_text: z
    .string()
    .trim()
    .regex(/^\d{5}(?:-\d{4})?$/),
});
const pageSchema = z.object({
  "@type": z.union([z.string(), z.array(z.string())]),
  url: z.string().url(),
  name: z.string(),
  address: z.object({
    streetAddress: z.string().trim().min(1),
    addressLocality: z
      .string()
      .trim()
      .min(1)
      .refine((value) => value.toLowerCase() !== "unknown"),
    addressRegion: z.string(),
    postalCode: z
      .string()
      .trim()
      .regex(/^\d{5}(?:-\d{4})?$/),
    addressCountry: z.literal("US"),
  }),
  geo: z.object({
    latitude: z.number().finite().min(-90).max(90),
    longitude: z.number().finite().min(-180).max(180),
  }),
});
const graphSchema = z.object({ "@graph": z.array(z.unknown()) });
const normalize = (value: string) =>
  value.toLowerCase().replace(/[^a-z0-9]/g, "");
const streetAbbreviations = new Map([
  ["street", "st"],
  ["road", "rd"],
  ["avenue", "ave"],
  ["boulevard", "blvd"],
  ["drive", "dr"],
  ["highway", "hwy"],
  ["parkway", "pkwy"],
  ["lane", "ln"],
  ["north", "n"],
  ["south", "s"],
  ["so", "s"],
  ["east", "e"],
  ["west", "w"],
]);
function normalizeStreet(value: string): string {
  return normalize(
    value
      .toLowerCase()
      .replace(/\bu\.?\s*s\.?\s+(?=(?:highway|hwy)\b)/g, "")
      .replace(/\b[a-z]+\b/g, (word) => streetAbbreviations.get(word) ?? word),
  );
}

/** Match the chain location and ZIP; verify its street address on the official page next. */
export function matchesPullapartOrganization(
  raw: unknown,
  location: Pick<PullapartLocation, "locationName" | "cityName" | "zipCode">,
): boolean {
  const parsed = organizationSchema.safeParse(raw);
  if (!parsed.success) return false;
  const org = parsed.data;
  return (
    normalize(org.name_text.replace(/^Pull A Part - /i, "")) ===
      normalize(location.locationName) &&
    org.address_zip_text.slice(0, 5) === location.zipCode.trim().slice(0, 5)
  );
}

/** Read coordinates from the matched yard's own page, never a ZIP centroid or a sibling's page. */
export function parsePullapartPageGeo(
  html: string,
  expected: {
    orgLookup: string;
    url: string;
    name: string;
    postalCode: string;
    state: string;
    streetAddress: string;
    operator: string;
  },
): AutorecyclerOrgGeo | null {
  const canonical = [
    ...stripInventoryRawText(html).matchAll(
      /<link\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi,
    ),
  ].filter(
    (match) =>
      inventoryHtmlAttribute(match[0], "rel")?.toLowerCase() === "canonical",
  );
  if (
    canonical.length !== 1 ||
    inventoryHtmlAttribute(canonical[0]?.[0] ?? "", "href") !== expected.url
  )
    return null;
  const matches: AutorecyclerOrgGeo[] = [];
  for (const script of html
    .replace(/<!--[\s\S]*?-->/g, "")
    .matchAll(
      /(<script\b(?:[^>"']|"[^"]*"|'[^']*')*>)([\s\S]*?)<\/script\s*>/gi,
    )) {
    if (
      inventoryHtmlAttribute(script[1] ?? "", "type")?.toLowerCase() !==
      "application/ld+json"
    )
      continue;
    let json: unknown;
    try {
      json = JSON.parse(script[2] ?? "");
    } catch {
      continue;
    }
    const graph = graphSchema.safeParse(json);
    for (const node of graph.success ? graph.data["@graph"] : [json]) {
      const parsed = pageSchema.safeParse(node);
      if (!parsed.success) continue;
      const data = parsed.data;
      const types =
        typeof data["@type"] === "string" ? [data["@type"]] : data["@type"];
      const region = normalizeRegion(data.address.addressRegion);
      if (
        !types.some(
          (type) => type === "AutoPartsStore" || type === "AutomotiveBusiness",
        ) ||
        data.url !== expected.url ||
        (normalize(data.name) !== normalize(expected.name) &&
          normalize(data.name) !==
            normalize(
              `${expected.operator} ${data.address.addressLocality}`,
            )) ||
        normalizeStreet(data.address.streetAddress) !==
          normalizeStreet(expected.streetAddress) ||
        data.address.postalCode.slice(0, 5) !==
          expected.postalCode.trim().slice(0, 5) ||
        !region.stateAbbr ||
        region.stateAbbr !== normalizeRegion(expected.state).stateAbbr ||
        (data.geo.latitude === 0 && data.geo.longitude === 0)
      )
        continue;
      matches.push({
        orgLookup: expected.orgLookup,
        locationName: data.name,
        locationCity: data.address.addressLocality,
        state: region.state,
        stateAbbr: region.stateAbbr,
        lat: data.geo.latitude,
        lng: data.geo.longitude,
        address: `${data.address.streetAddress}, ${data.address.addressLocality}, ${region.stateAbbr} ${data.address.postalCode}, USA`,
      });
    }
  }
  return matches.length === 1 ? (matches[0] ?? null) : null;
}

export function resolveAutorecyclerPullapartGeo(
  raw: unknown,
  orgLookup: string,
): Effect.Effect<AutorecyclerOrgGeo | null, Error> {
  return Effect.gen(function* () {
    if (!organizationSchema.safeParse(raw).success) return null;
    const locations = yield* fetchPullapartLocations();
    const matches = locations.filter((location) =>
      matchesPullapartOrganization(raw, location),
    );
    if (matches.length !== 1) return null;
    const location = matches[0];
    if (!location) return null;
    const operator = location.siteTypeID === 5 ? "U-Pull-&-Pay" : "Pull-A-Part";
    const name = `${operator} - ${location.locationName}`;
    const website = resolveYardWebsite({
      source: "pullapart",
      code: String(location.locationID),
      name,
      operator,
      state: location.stateName,
    });
    if (website?.kind !== "yard") return null;
    const html = yield* fetchProviderText({
      url: website.href,
      context: `AutoRecycler official Pull-A-Part location ${location.locationID}`,
      retry: { retryLimit: 1 },
    });
    return yield* Effect.try({
      try: () =>
        parsePullapartPageGeo(html, {
          orgLookup,
          url: website.href,
          name,
          postalCode: location.zipCode,
          state: location.stateName,
          streetAddress: location.address1,
          operator,
        }),
      catch: (cause) =>
        new Error(
          `Official Pull-A-Part location ${location.locationID} returned invalid location markup`,
          { cause },
        ),
    });
  });
}
