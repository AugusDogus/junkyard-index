import { Data, Effect } from "effect";
import { readIPullUPullResponseText } from "./ipullupull-response-text";
import { parseFenixInventory, type FenixOrder } from "./fenix-parser";
import {
  FENIX_INVENTORY_URL,
  FENIX_LOCATION_PREFERENCES,
  type FenixYardCode,
} from "./fenix-yard-metadata";
import type { ProviderRequestGate } from "./provider-http-client";

export class FenixProviderError extends Data.TaggedError("FenixProviderError")<{
  operation: string;
  cause: unknown;
}> {
  override get message() {
    return `Fenix ${this.operation}: ${this.cause instanceof Error ? this.cause.message : String(this.cause)}. Published inventory is preserved and this chunk has no accepted checkpoint. Inspect the native response and retry the last validated checkpoint.`;
  }
}

export function fetchFenixPage(
  url: string,
  yard: FenixYardCode,
  order: FenixOrder,
  page: number,
  gate: ProviderRequestGate,
) {
  return gate(
    Effect.tryPromise({
      try: async (signal) => {
        const parsed = URL.parse(url);
        if (
          !parsed ||
          parsed.origin !== new URL(FENIX_INVENTORY_URL).origin ||
          parsed.pathname !== "/recent-inventory/" ||
          parsed.username ||
          parsed.password ||
          parsed.hash
        )
          throw new Error("Unsupported Fenix inventory destination");
        const timeout = AbortSignal.any([signal, AbortSignal.timeout(20_000)]);
        const response = await fetch(url, {
          redirect: "error",
          signal: timeout,
          headers: {
            "User-Agent": "JunkyardIndex/1.0",
            Accept: "text/html",
            Cookie: "fnx_location=" + FENIX_LOCATION_PREFERENCES[yard],
          },
        });
        if (
          response.status !== 200 ||
          response.headers.has("content-range") ||
          response.headers
            .get("content-type")
            ?.split(";")[0]
            ?.trim()
            .toLowerCase() !== "text/html" ||
          (response.url && response.url !== url)
        ) {
          await response.body?.cancel();
          throw new Error(
            "Native inventory requires unredirected HTTP 200, text/html and a complete body",
          );
        }
        return parseFenixInventory(
          await readIPullUPullResponseText(
            response,
            "Fenix inventory",
            timeout,
          ),
          yard,
          order,
          page,
        );
      },
      catch: (cause) =>
        new FenixProviderError({
          operation: `${yard} ${order} page ${page}`,
          cause,
        }),
    }),
  );
}
