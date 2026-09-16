import { Effect, Schema } from "effect";
import {
  inventoryHtmlAttribute,
  stripInventoryRawText,
} from "./inventory-html";
import {
  IPULLUPULL_INVENTORY_URL,
  IPULLUPULL_MAX_CATALOG_RECORDS,
  IPullUPullProviderError,
} from "./ipullupull-client";
import {
  fetchProviderResponse,
  type ProviderRequestGate,
} from "./provider-http-client";
import { hasHttpPaginationLink } from "./provider-http-pagination";
import { readIPullUPullResponseText } from "./ipullupull-response-text";

const PAGE_SIZE = 96;
const Gallery = Schema.Array(Schema.Struct({ url: Schema.String }));
export type IPullUPullMedia = {
  stock: string;
  vin: string;
  city: string;
  imageUrl: string | null;
};

export function ipullUPullMediaKey(stock: string, vin: string, city: string) {
  return JSON.stringify([
    stock.trim(),
    vin.trim().toUpperCase(),
    city.trim().toUpperCase(),
  ]);
}

function decode(value: string): string {
  return value.replace(
    /&(?:quot|amp|apos|lt|gt|#\d+|#x[\da-f]+);/gi,
    (entity) => {
      switch (entity.toLowerCase()) {
        case "&quot;":
          return '"';
        case "&amp;":
          return "&";
        case "&apos;":
          return "'";
        case "&lt;":
          return "<";
        case "&gt;":
          return ">";
        default:
          return String.fromCodePoint(
            entity.toLowerCase().startsWith("&#x")
              ? parseInt(entity.slice(3, -1), 16)
              : Number(entity.slice(2, -1)),
          );
      }
    },
  );
}

/** The server-rendered cards publish asset galleries separately from part photos. */
export function parseIPullUPullMediaPage(html: string, page: number) {
  const clean = stripInventoryRawText(html);
  if (!/<\/body\s*>\s*<\/html\s*>\s*$/i.test(clean))
    throw new Error("Incomplete media HTML document");
  const sections = [
    ...clean.matchAll(
      /<section\b((?:[^>"']|"[^"]*"|'[^']*')*)>([\s\S]*?)<\/section\s*>/gi,
    ),
  ].filter(
    (match) =>
      inventoryHtmlAttribute(match[1] ?? "", "data-slug") ===
      "inventory-pricing",
  );
  const section = sections[0];
  if (sections.length !== 1 || !section)
    throw new Error("Expected one inventory media catalog");
  const tag = section[1] ?? "";
  const content = section[2] ?? "";
  const total = Number(inventoryHtmlAttribute(tag, "data-total"));
  if (
    Number(inventoryHtmlAttribute(tag, "data-page")) !== page ||
    Number(inventoryHtmlAttribute(tag, "data-per-page")) !== PAGE_SIZE ||
    !Number.isInteger(total) ||
    total < 1 ||
    total > IPULLUPULL_MAX_CATALOG_RECORDS
  )
    throw new Error("Invalid media page/total/per-page metadata");
  const articles = [
    ...content.matchAll(
      /<article\b((?:[^>"']|"[^"]*"|'[^']*')*)>([\s\S]*?)<\/article\s*>/gi,
    ),
  ];
  if (
    articles.length !== Math.min(PAGE_SIZE, total - (page - 1) * PAGE_SIZE) ||
    [...content.matchAll(/<\/?article\b/gi)].length !== articles.length * 2
  )
    throw new Error("Missing or truncated media cards");
  const items = articles.map((article): IPullUPullMedia => {
    const attributes = article[1] ?? "";
    const stock = decode(
      inventoryHtmlAttribute(attributes, "data-stock") ?? "",
    ).trim();
    const galleryAttribute = inventoryHtmlAttribute(attributes, "data-gallery");
    if (!stock || galleryAttribute === null)
      throw new Error("Missing media stock/gallery metadata");
    const specs = new Map<string, string>();
    for (const spec of (article[2] ?? "").matchAll(
      /<dt>([^<]*)<\/dt>\s*<dd>([^<]*)<\/dd>/gi,
    )) {
      const name = decode(spec[1] ?? "");
      if (!["VIN", "Yard City", "Stock #"].includes(name)) continue;
      if (specs.has(name)) throw new Error(`Duplicate media spec ${name}`);
      specs.set(name, decode(spec[2] ?? "").trim());
    }
    // Part-only cards and invalid assets omit VIN/yard labels. They still count
    // toward pagination but cannot match eligible CSV identities. The connector
    // requires an exact stock + VIN + yard match before emitting each vehicle.
    const vin = specs.get("VIN") ?? "";
    const city = specs.get("Yard City") ?? "";
    if (specs.get("Stock #") !== stock)
      throw new Error(`Missing or inconsistent media identity for ${stock}`);
    const json: unknown = JSON.parse(decode(galleryAttribute));
    const gallery = Schema.decodeUnknownSync(Gallery)(json);
    const imageUrl = gallery[0]?.url ?? null;
    if (imageUrl !== null) {
      const url = URL.parse(imageUrl);
      const originalPrefix = `/wp-content/uploads/ipullupull-catalog/${encodeURIComponent(stock)}/`;
      const assetPath =
        url &&
        (/^\/wp-content\/uploads\/ipullupull-optimized\/[\da-f]{2}\/[\da-f]+-(?:large|medium|thumbnail)\.(?:webp|jpg)$/.test(
          url.pathname,
        ) ||
          (url.pathname.startsWith(originalPrefix) &&
            /^[^/]+\.(?:jpe?g|png|webp)$/i.test(
              url.pathname.slice(originalPrefix.length),
            )));
      if (
        !url ||
        url.origin !== "https://ipullupull.com" ||
        url.username ||
        url.password ||
        !assetPath ||
        url.search ||
        url.hash
      )
        throw new Error(
          `Unrecognized asset image URL for ${stock}; inspect the upstream gallery`,
        );
    }
    return { stock, vin, city, imageUrl };
  });
  return { total, items };
}

function fetchMediaPage(page: number, requestGate: ProviderRequestGate) {
  const url = new URL(IPULLUPULL_INVENTORY_URL);
  url.searchParams.set("ipull_inventory_pricing_perpage", String(PAGE_SIZE));
  url.searchParams.set("ipull_inventory_pricing_sort", "stock_number");
  url.searchParams.set("ipull_inventory_pricing_order", "asc");
  url.searchParams.set("ipull_inventory_pricing_page", String(page));
  return fetchProviderResponse({
    url: url.href,
    context: `iPull-uPull media page ${page}`,
    requestGate,
    retry: { retryLimit: 2, retryNetworkErrors: false, jitter: false },
  }).pipe(
    Effect.flatMap((response) =>
      Effect.tryPromise({
        try: async (signal) => {
          if (
            response.status !== 200 ||
            response.headers.has("content-range") ||
            hasHttpPaginationLink(response.headers) ||
            !response.headers
              .get("content-type")
              ?.toLowerCase()
              .startsWith("text/html")
          )
            throw new Error(
              `Media page ${page} returned HTTP ${response.status}, partial headers, or non-HTML content`,
            );
          return parseIPullUPullMediaPage(
            await readIPullUPullResponseText(
              response,
              `media page ${page}`,
              signal,
            ),
            page,
          );
        },
        catch: (cause) => new IPullUPullProviderError({ cause }),
      }),
    ),
  );
}

/** No per-vehicle requests. Keep all media inside the existing atomic checkpoint. */
export function fetchIPullUPullMedia(requestGate: ProviderRequestGate) {
  return Effect.gen(function* () {
    const media = new Map<string, IPullUPullMedia>();
    let total: number | undefined;
    for (
      let page = 1;
      total === undefined || (page - 1) * PAGE_SIZE < total;
      page++
    ) {
      const result = yield* fetchMediaPage(page, requestGate);
      if (total !== undefined && result.total !== total)
        return yield* new IPullUPullProviderError({
          cause:
            "Media catalog changed during pagination; retry from cursor 0. No batches emitted.",
        });
      total = result.total;
      for (const item of result.items) {
        const key = ipullUPullMediaKey(item.stock, item.vin, item.city);
        if (media.has(key))
          return yield* new IPullUPullProviderError({
            cause: `Repeated media identity ${item.stock}; retry the changing catalog from cursor 0. No batches emitted.`,
          });
        media.set(key, item);
      }
    }
    return media;
  }).pipe(
    Effect.mapError(
      (cause) =>
        new IPullUPullProviderError({
          cause: `Media enrichment unavailable: ${cause.message}. No vehicle updates were emitted; prior images are preserved. Inspect the public catalog and retry from cursor 0.`,
        }),
    ),
  );
}
