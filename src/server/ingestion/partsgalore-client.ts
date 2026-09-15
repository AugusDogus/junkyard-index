import { Data, Effect } from "effect";
import {
  fetchProviderText,
  type ProviderRequestGate,
} from "./provider-http-client";
import { parsePartsGaloreCatalog } from "./partsgalore-parser";

export const PARTSGALORE_INVENTORY_URL = "https://parts-galore.com/inventory/";

export class PartsGaloreProviderError extends Data.TaggedError(
  "PartsGaloreProviderError",
)<{
  cause: unknown;
}> {
  override get message() {
    return `Parts Galore catalog: ${this.cause instanceof Error ? this.cause.message : String(this.cause)}`;
  }
}

/** /content/js/inventory-search.js only hides/shows existing #alldata rows.
 * Fetch the unfiltered HTML once. Its old.lndo.site canonical is not a data URL.
 */
export function fetchPartsGaloreCatalog(requestGate?: ProviderRequestGate) {
  return fetchProviderText({
    url: PARTSGALORE_INVENTORY_URL,
    context: "Parts Galore inventory",
    headers: { "User-Agent": "JunkyardIndex/1.0", Accept: "text/html" },
    requestGate,
    retry: {
      timeoutMs: 20_000,
      retryLimit: 2,
      retryNetworkErrors: false,
      jitter: false,
    },
    onResponse: (response) => {
      if (
        response.status === 206 ||
        response.headers.has("content-range") ||
        /rel\s*=\s*["']?next\b/i.test(response.headers.get("link") ?? "")
      )
        throw new Error(
          "Parts Galore returned partial inventory; inspect the public endpoint's pagination before retrying",
        );
      if (
        response.url &&
        new URL(response.url).origin !== "https://parts-galore.com"
      )
        throw new Error(
          "Parts Galore redirected outside its verified public origin; inspect the inventory URL before retrying",
        );
    },
  }).pipe(
    Effect.mapError((cause) => new PartsGaloreProviderError({ cause })),
    Effect.flatMap(parsePartsGaloreCatalog),
  );
}
