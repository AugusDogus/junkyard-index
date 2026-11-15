import { Effect } from "effect";
import { readIPullUPullResponseText } from "./ipullupull-response-text";
import {
  fetchProviderResponse,
  type ProviderRequestGate,
} from "./provider-http-client";

// Both suppliers share this host. Hold the permit through body read and gap.
const serial = Effect.runSync(Effect.makeSemaphore(1));
export const heavyTruckPartsRequestGate: ProviderRequestGate = (request) =>
  serial.withPermits(1)(request);
export function fetchHeavyTruckPartsPage(
  url: string,
  gate: ProviderRequestGate,
  label: string,
) {
  return heavyTruckPartsRequestGate(
    gate(
      Effect.gen(function* () {
        const response = yield* fetchProviderResponse({
          url,
          context: label + " " + url,
          redirect: "manual",
          // Every status is inspected here so the body is cancelled before stopping.
          retry: {
            timeoutMs: 25_000,
            retryLimit: 0,
            retryNetworkErrors: false,
            retryableStatusCodes: [],
          },
        });
        if (
          response.status !== 200 ||
          response.redirected ||
          response.headers.has("content-range") ||
          (response.url && response.url !== url) ||
          response.headers
            .get("content-type")
            ?.split(";")[0]
            ?.trim()
            .toLowerCase() !== "text/html"
        ) {
          yield* Effect.tryPromise({
            try: async () => {
              await response.body?.cancel();
            },
            catch: (cause) => cause,
          });
          return yield* Effect.fail(
            new Error(
              `Expected complete unredirected HTML HTTP 200, received ${response.status}`,
            ),
          );
        }
        return yield* Effect.tryPromise({
          try: () =>
            readIPullUPullResponseText(
              response,
              label + " inventory",
              AbortSignal.timeout(25_000),
              2 * 1024 * 1024,
            ),
          catch: (cause) => cause,
        });
      }).pipe(
        // The caller's shared-host gate covers the complete body and completed gap.
        Effect.ensuring(Effect.sleep("4 seconds")),
        Effect.mapError((cause) =>
          cause instanceof Error ? cause : new Error(String(cause)),
        ),
      ),
    ),
  );
}
