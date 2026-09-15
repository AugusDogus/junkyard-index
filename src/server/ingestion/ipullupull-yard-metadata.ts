import { Effect, Either, Schema } from "effect";
import { Yard } from "~/lib/yard";
import {
  fetchProviderText,
  type ProviderRequestGate,
} from "./provider-http-client";

export type IPullUPullYard = Yard & { source: "ipullupull" };
export const IPULLUPULL_KNOWN_CITIES = [
  "FRESNO",
  "POMONA",
  "SACRAMENTO",
  "STOCKTON",
] as const;
const DIRECTORY_URL = "https://ipullupull.com/locations/";
const nonempty = Schema.String.pipe(
  Schema.filter((text) => text.trim().length > 0),
);
const YardMetadataSchema = Schema.Struct({
  "@type": Schema.Literal("AutoDealer"),
  address: Schema.Struct({
    streetAddress: nonempty,
    addressLocality: nonempty,
    postalCode: nonempty,
    addressCountry: Schema.Literal("USA"),
  }),
  telephone: Schema.optional(Schema.String),
  geo: Schema.Struct({
    latitude: Schema.Number.pipe(Schema.between(-90, 90)),
    longitude: Schema.Number.pipe(Schema.between(-180, 180)),
  }),
});

/** Follow only same-origin yard links actually published in the directory. */
export function ipullUPullDirectoryLinks(html: string): URL[] {
  const links = new Map<string, URL>();
  for (const match of html.matchAll(/href\s*=\s*["']([^"']+)["']/gi)) {
    const url = URL.parse(match[1] ?? "", DIRECTORY_URL);
    if (
      url?.origin === "https://ipullupull.com" &&
      /^\/locations\/[a-z]+(?:-[a-z]+)*-[a-z]{2}\/$/.test(url.pathname)
    ) {
      url.search = "";
      url.hash = "";
      links.set(url.href, url);
    }
  }
  return [...links.values()];
}

export function parseIPullUPullYard(
  html: string,
  url: URL,
  city: string,
): IPullUPullYard | null {
  for (const script of html.matchAll(
    /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  )) {
    const json = Either.try((): unknown => JSON.parse(script[1] ?? ""));
    if (Either.isLeft(json)) continue;
    const parsed = Schema.decodeUnknownEither(YardMetadataSchema)(json.right);
    if (Either.isLeft(parsed)) continue;
    const data = parsed.right;
    // The current first-party JSON-LD puts state in addressLocality, not addressRegion.
    const locality = /^(.+), ([A-Z]{2})$/.exec(
      data.address.addressLocality.trim(),
    );
    const name = locality?.[1];
    const state = locality?.[2];
    const slug = url.pathname.split("/")[2];
    if (
      !name ||
      !state ||
      !slug ||
      name.toUpperCase() !== city ||
      !slug.endsWith(`-${state.toLowerCase()}`)
    )
      continue;
    const coordinates = Yard.coordinates(data.geo.latitude, data.geo.longitude);
    if (coordinates.lat === null || coordinates.lng === null) continue;
    return {
      source: "ipullupull",
      code: `IPULLUPULL-${slug.toUpperCase()}`,
      name: `iPull-uPull - ${name}`,
      operator: "iPull-uPull",
      address: data.address.streetAddress.trim(),
      city: name,
      state,
      postalCode: data.address.postalCode.trim(),
      ...coordinates,
      websiteUrl: Yard.website(url.href),
      phone: data.telephone?.trim() || null,
      email: null,
    };
  }
  return null;
}

function fetchMetadata(url: string, requestGate: ProviderRequestGate) {
  return fetchProviderText({
    url,
    context: `iPull-uPull yard metadata ${url}`,
    requestGate,
    retry: { retryLimit: 2, retryNetworkErrors: false, jitter: false },
    onResponse: (response) => {
      if (response.status === 206 || response.headers.has("content-range"))
        throw new Error(
          `Partial yard metadata from ${url}; retry the complete page.`,
        );
    },
  });
}

export function loadIPullUPullYards(
  cities: ReadonlySet<string>,
  requestGate: ProviderRequestGate,
) {
  return Effect.gen(function* () {
    const yards = new Map<string, IPullUPullYard>();
    const warnings: string[] = [];
    if (cities.size === 0) return { yards, warnings };
    const directory = yield* Effect.either(
      fetchMetadata(DIRECTORY_URL, requestGate),
    );
    if (Either.isLeft(directory)) {
      warnings.push(
        `iPull-uPull yard directory unavailable: ${directory.left.message}. Observed VINs preserve prior inventory; retry metadata loading.`,
      );
      return { yards, warnings };
    }
    const links = ipullUPullDirectoryLinks(directory.right);
    for (const city of cities) {
      const slug = city.toLowerCase().replace(/\s+/g, "-");
      const candidates = links.filter(
        (url) =>
          /^\/locations\/(.+)-[a-z]{2}\/$/.exec(url.pathname)?.[1] === slug,
      );
      if (candidates.length !== 1) continue;
      const url = candidates[0];
      if (!url) continue;
      const page = yield* Effect.either(fetchMetadata(url.href, requestGate));
      if (Either.isLeft(page)) {
        warnings.push(
          `iPull-uPull ${city} metadata unavailable: ${page.left.message}. Retry this yard page; observed VINs preserve prior inventory.`,
        );
        continue;
      }
      const yard = parseIPullUPullYard(page.right, url, city);
      if (yard) yards.set(city, yard);
    }
    return { yards, warnings };
  });
}
