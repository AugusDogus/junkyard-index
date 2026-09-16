import { Effect, Either, Schema } from "effect";
import { Yard } from "~/lib/yard";
import {
  inventoryHtmlAttribute,
  stripInventoryRawText,
} from "./inventory-html";
import {
  fetchProviderText,
  type ProviderRequestGate,
} from "./provider-http-client";

export type IPullUPullYard = Yard & { source: "ipullupull" };
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
  for (const match of stripInventoryRawText(html).matchAll(
    /<a\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi,
  )) {
    const url = URL.parse(
      inventoryHtmlAttribute(match[0], "href") ?? "",
      DIRECTORY_URL,
    );
    if (
      url?.origin === "https://ipullupull.com" &&
      !url.username &&
      !url.password &&
      /^\/locations\/[a-z]+(?:-[a-z]+)*-[a-z]{2}\/$/.test(url.pathname)
    ) {
      url.search = "";
      url.hash = "";
      links.set(url.href, url);
    }
  }
  return [...links.values()];
}

/** Only the directory's location cards establish eligibility, not historical
 * CSV cities or navigation/footer links. Reject incomplete or ambiguous lists.
 */
export function parseIPullUPullDirectory(
  html: string,
): ReadonlyMap<string, URL> {
  const clean = stripInventoryRawText(html);
  const bodies = [...clean.matchAll(/<body\b[^>]*>([\s\S]*?)<\/body\s*>/gi)];
  const body = bodies[0]?.[1];
  if (
    bodies.length !== 1 ||
    body === undefined ||
    !/<\/html\s*>\s*$/i.test(clean.trim())
  )
    throw new Error(
      "iPull-uPull directory is missing a complete HTML document",
    );
  const figures = [
    ...body.matchAll(
      /<figure\b((?:[^>"']|"[^"]*"|'[^']*')*)>([\s\S]*?)<\/figure\s*>/gi,
    ),
  ];
  if (figures.length * 2 !== [...body.matchAll(/<\/?figure\b/gi)].length)
    throw new Error("iPull-uPull directory has incomplete location cards");
  const directory = new Map<string, URL>();
  for (const figure of figures) {
    if (
      !(inventoryHtmlAttribute(figure[1] ?? "", "class") ?? "")
        .split(/\s+/)
        .includes("wp-block-image")
    )
      continue;
    const links = ipullUPullDirectoryLinks(figure[2] ?? "");
    const url = links[0];
    const slug = url
      ? /^\/locations\/(.+)-[a-z]{2}\/$/.exec(url.pathname)?.[1]
      : undefined;
    if (links.length !== 1 || !url || !slug)
      throw new Error(
        "iPull-uPull directory location card lacks one unambiguous yard link",
      );
    const city = slug.replaceAll("-", " ").toUpperCase();
    if (directory.has(city))
      throw new Error(`iPull-uPull directory has ambiguous city ${city}`);
    directory.set(city, url);
  }
  if (directory.size === 0)
    throw new Error("iPull-uPull directory returned no location cards");
  return directory;
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

export function loadIPullUPullDirectory(requestGate: ProviderRequestGate) {
  return fetchMetadata(DIRECTORY_URL, requestGate).pipe(
    Effect.flatMap((html) => Effect.try(() => parseIPullUPullDirectory(html))),
    Effect.mapError(
      (cause) =>
        new Error(
          `iPull-uPull directory eligibility could not be verified: ${cause.message}. Inspect the public locations page before retrying; no catalog was accepted.`,
        ),
    ),
  );
}

export function loadIPullUPullYards(
  cities: ReadonlySet<string>,
  directory: ReadonlyMap<string, URL>,
  requestGate: ProviderRequestGate,
) {
  return Effect.gen(function* () {
    const yards = new Map<string, IPullUPullYard>();
    const warnings: string[] = [];
    for (const city of cities) {
      const url = directory.get(city);
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
