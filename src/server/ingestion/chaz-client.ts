import { sharedProviderHostSlot } from "./shared-provider-host";
import { Data, Effect } from "effect";
import { RetryableHttpStatusError } from "./errors";
import {
  ProviderChunkClock,
  ProviderNotReadyDeferred,
} from "./provider-chunk-clock";
import { fetchProviderResponse } from "./provider-http-client";
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

/** The LiteSpeed origin answers these for minutes on single pages while its
 * neighbours still answer 200 (production 2026-11-26), and rate limits with
 * 429 after a few hundred pages in a day of reruns, so they defer the chunk
 * instead of failing the run. */
const ORIGIN_UNAVAILABLE_STATUSES = [429, 502, 503, 504];

/** One native page inside its URG host slot. The caller's own pacing gate
 * belongs outside the shared host turn, so it does not hold the lane. */
export function fetchChazPage(url: string) {
  return Effect.suspend(() => {
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
          retryableStatusCodes: ORIGIN_UNAVAILABLE_STATUSES,
          retryNetworkErrors: false,
        },
        onResponse: (response) => {
          // The shared client raises these as RetryableHttpStatusError.
          if (ORIGIN_UNAVAILABLE_STATUSES.includes(response.status)) return;
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
  }).pipe(
    sharedProviderHostSlot(url),
    Effect.mapError((cause) =>
      ProviderChunkClock.isDeferral(cause)
        ? cause
        : cause instanceof RetryableHttpStatusError
          ? new ProviderNotReadyDeferred({
              provider: "Chaz",
              detail:
                url +
                " answered HTTP " +
                cause.status +
                " while the origin is unavailable.",
            })
          : new ChazProviderError({ operation: url, cause }),
    ),
  );
}
