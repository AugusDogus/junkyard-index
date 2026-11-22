import { Effect } from "effect";
import {
  readBoundedResponseText,
  type ResponseTextDecoding,
} from "./ipullupull-response-text";
import { heavyTruckPartsHostSlot } from "./heavytruckparts-host-slot";
import {
  fetchProviderResponse,
  type ProviderRequestGate,
} from "./provider-http-client";

// HTP pages declare UTF-8 but carry stray windows-1252 bytes, such as 0xD7 in
// Crest's "4x4" description. Completeness rests on the census guards, not on
// rejecting a malformed character. Dutcher and C&S stay strict.
export const HTP_TEXT_DECODING: ResponseTextDecoding = "utf-8-replace";
// All three sources share this local gate and the deployed Redis host lease.
const serial = Effect.runSync(Effect.makeSemaphore(1));
export const heavyTruckPartsRequestGate: ProviderRequestGate = (request) =>
  serial.withPermits(1)(request);
export function fetchHeavyTruckPartsPage(
  url: string,
  gate: ProviderRequestGate,
  label: string,
  decoding: ResponseTextDecoding,
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
            readBoundedResponseText(
              response,
              label + " inventory",
              AbortSignal.timeout(25_000),
              2 * 1024 * 1024,
              decoding,
            ),
          catch: (cause) => cause,
        });
      }).pipe(
        // Keep the deployed host lease through the body and completed gap.
        Effect.ensuring(Effect.sleep("4 seconds")),
        Effect.mapError((cause) =>
          cause instanceof Error ? cause : new Error(String(cause)),
        ),
        heavyTruckPartsHostSlot,
      ),
    ),
  );
}
