import { sharedProviderHostSlot } from "./shared-provider-host";
import { Data, Effect } from "effect";
import {
  fetchProviderResponse,
  type ProviderRequestGate,
} from "./provider-http-client";
import { readIPullUPullResponseText } from "./ipullupull-response-text";
import {
  CHAZ_CONTACT,
  CHAZ_MAKES,
  CHAZ_ROOT,
  chazBrowsePath,
} from "./chaz-yard-metadata";

export class ChazProviderError extends Data.TaggedError("ChazProviderError")<{
  operation: string;
  cause: unknown;
}> {
  override get message() {
    const detail =
      this.cause instanceof Error ? this.cause.message : String(this.cause);
    return `Chaz ${this.operation}: ${detail}. No advanced checkpoint was accepted; prior inventory is preserved. Inspect the native source and resume only from the last validated checkpoint.`;
  }
}

export function fetchChazPage(url: string, gate: ProviderRequestGate) {
  return gate(
    Effect.suspend(() => {
      const deadline = AbortSignal.timeout(20_000);
      return Effect.gen(function* () {
        if (
          ![CHAZ_ROOT, CHAZ_CONTACT, CHAZ_MAKES].includes(url) &&
          !chazBrowsePath(url, 1) &&
          !chazBrowsePath(url, 2)
        )
          return yield* Effect.fail(
            new Error("Destination is outside the finite Chaz browse graph"),
          );
        const response = yield* fetchProviderResponse({
          url,
          context: "Chaz " + url,
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
                .toLowerCase() !== "text/html"
            )
              throw new Error(
                "Expected complete unredirected Chaz HTTP200 text/html, received " +
                  response.status,
              );
          },
        });
        const html = yield* Effect.tryPromise({
          try: () =>
            readIPullUPullResponseText(response, "Chaz " + url, deadline),
          catch: (cause) => cause,
        });
        if (Buffer.byteLength(html) > 2 * 1024 * 1024)
          return yield* Effect.fail(
            new Error(
              "Chaz document exceeds 2 MiB; inspect source growth before resuming",
            ),
          );
        return html;
      }).pipe(
        Effect.timeoutFail({
          duration: "20 seconds",
          onTimeout: () =>
            new Error("Combined request/body deadline exceeded 20 seconds"),
        }),
      );
    }),
  ).pipe(
    sharedProviderHostSlot(url),
    Effect.mapError(
      (cause) => new ChazProviderError({ operation: url, cause }),
    ),
  );
}
