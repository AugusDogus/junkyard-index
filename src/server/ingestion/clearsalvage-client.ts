import { Data, Effect } from "effect";
import { readIPullUPullResponseText } from "./ipullupull-response-text";
import {
  fetchProviderResponse,
  type ProviderRequestGate,
} from "./provider-http-client";
import {
  parseClearsalvageCatalog,
  parseClearsalvageDetail,
  type ClearsalvagePost,
} from "./clearsalvage-parser";
import {
  CLEARSALVAGE_MAX_RESPONSE_BYTES,
  clearsalvageCatalogPage,
  isClearsalvageDonorUrl,
} from "./clearsalvage-yard-metadata";

export class ClearsalvageProviderError extends Data.TaggedError(
  "ClearsalvageProviderError",
)<{ operation: string; cause: unknown }> {
  override get message() {
    const detail =
      this.cause instanceof Error ? this.cause.message : String(this.cause);
    return `Clear Salvage ${this.operation}: ${detail}. Prior inventory is preserved; no advanced checkpoint was accepted. Inspect the native source and resume from the last validated checkpoint.`;
  }
}
export const clearsalvageValidated = <A>(operation: string, run: () => A) =>
  Effect.try({
    try: run,
    catch: (cause) => new ClearsalvageProviderError({ operation, cause }),
  });

function read<A>(
  url: string,
  mime: string,
  parse: (raw: string, headers: Headers) => A,
  gate: ProviderRequestGate,
  maximumBytes: number,
) {
  return gate(
    Effect.suspend(() => {
      const signal = AbortSignal.timeout(20_000);
      return Effect.gen(function* () {
        if (
          (mime === "application/json"
            ? clearsalvageCatalogPage(url) === null
            : !isClearsalvageDonorUrl(url)) ||
          !Number.isSafeInteger(maximumBytes) ||
          maximumBytes < 1 ||
          maximumBytes > CLEARSALVAGE_MAX_RESPONSE_BYTES
        )
          return yield* Effect.fail(
            new Error(
              "Destination is outside the verified Clear Salvage public inventory graph",
            ),
          );
        const response = yield* fetchProviderResponse({
          url,
          context: "Clear Salvage " + url,
          method: "GET",
          redirect: "manual",
          retry: {
            timeoutMs: 20_000,
            retryLimit: 0,
            retryNetworkErrors: false,
          },
          onResponse: (response) => {
            if (
              response.status !== 200 ||
              response.redirected ||
              response.headers.has("content-range") ||
              (response.url && response.url !== url) ||
              response.headers
                .get("content-type")
                ?.split(";")[0]
                ?.trim()
                .toLowerCase() !== mime
            )
              throw new Error(
                "Expected complete unredirected Clear Salvage HTTP 200 " +
                  mime +
                  ", received " +
                  response.status,
              );
          },
        });
        const raw = yield* Effect.tryPromise({
          try: () =>
            readIPullUPullResponseText(
              response,
              "Clear Salvage " + url,
              signal,
              maximumBytes,
            ),
          catch: (cause) => cause,
        });
        return yield* clearsalvageValidated("native response " + url, () =>
          parse(raw, response.headers),
        );
      }).pipe(
        Effect.timeoutFail({
          duration: "20 seconds",
          onTimeout: () =>
            new Error(
              "Combined Clear Salvage request/body deadline exceeded 20 seconds",
            ),
        }),
      );
    }),
  ).pipe(
    Effect.mapError((cause) =>
      cause instanceof ClearsalvageProviderError
        ? cause
        : new ClearsalvageProviderError({ operation: url, cause }),
    ),
  );
}
export const fetchClearsalvageCatalog = (
  url: string,
  gate: ProviderRequestGate,
  maximumBytes = CLEARSALVAGE_MAX_RESPONSE_BYTES,
) =>
  read(
    url,
    "application/json",
    (raw, headers) => parseClearsalvageCatalog(raw, url, headers),
    gate,
    maximumBytes,
  );
export const fetchClearsalvageDetail = (
  post: ClearsalvagePost,
  gate: ProviderRequestGate,
  maximumBytes = CLEARSALVAGE_MAX_RESPONSE_BYTES,
) =>
  read(
    post.url,
    "text/html",
    (raw) => parseClearsalvageDetail(raw, post),
    gate,
    maximumBytes,
  );
