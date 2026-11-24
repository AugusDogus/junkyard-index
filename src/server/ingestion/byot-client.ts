import { Effect } from "effect";
import { readIPullUPullResponseText } from "./ipullupull-response-text";
import type { ProviderRequestGate } from "./provider-http-client";
import { BYOT_YARDS } from "./byot-configuration";
import {
  BYOT_ARRIVALS_URL,
  BYOT_QUERIES,
  byotSearchUrl,
} from "./byot-directory";
import { ByotResult } from "./byot-result";

export const BYOT_REQUEST_TIMEOUT_MS = 45_000;
export const BYOT_MAX_BODY_BYTES = 2 * 1024 * 1024;
export const BYOT_REQUEST_GAP_MS = 2_000;
const serial = Effect.runSync(Effect.makeSemaphore(1));
/** Hold the permit through body completion and padding, including failures.
 * Module scope preserves the gap across consecutive connector chunks. */
export const byotRequestGate: ProviderRequestGate = (request) =>
  serial.withPermits(1)(
    request.pipe(Effect.ensuring(Effect.sleep(BYOT_REQUEST_GAP_MS))),
  );

async function document(
  url: string,
  code: string,
  signal: AbortSignal,
): Promise<string> {
  const yard = BYOT_YARDS.find((yard) => yard.code === code);
  if (!yard) throw new Error("Unknown BYOT yard " + code);
  const wireUrl = url;
  const response = await fetch(wireUrl, {
    method: "GET",
    redirect: "manual",
    signal,
    headers: {
      "User-Agent":
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36",
      Accept: "application/json",
      "Accept-Language": "en-US,en;q=0.9",
      Referer: yard.inventoryUrl,
      Origin: "https://www.byotautoparts.com",
      Location: code,
    },
  });
  if (
    response.status !== 200 ||
    response.redirected ||
    (response.url && response.url !== wireUrl) ||
    response.headers.has("content-range") ||
    response.headers
      .get("content-type")
      ?.split(";")[0]
      ?.trim()
      .toLowerCase() !== "application/json"
  ) {
    const failure = new Error(
      `Expected complete owned HTTP200 application/json at ${url}; received HTTP${response.status}${response.headers.has("retry-after") ? "; Retry-After: " + response.headers.get("retry-after") : ""}`,
    );
    try {
      await response.body?.cancel();
    } catch (cleanup) {
      throw new AggregateError(
        [failure, cleanup],
        failure.message + "; unread response cancellation also failed",
      );
    }
    throw failure;
  }
  return readIPullUPullResponseText(
    response,
    "Byot " + url,
    signal,
    BYOT_MAX_BODY_BYTES,
  );
}

/** Direct fetch is intentional: the shared response helper does not propagate
 * Effect interruption into its fetch signal. The shared bounded body reader is
 * reused while this adapter owns one request/body lifetime with no retry. */
export function readByotPage(
  url: string,
  code: string,
  gate: ProviderRequestGate = byotRequestGate,
) {
  return gate(
    Effect.suspend(() => {
      if (
        !BYOT_YARDS.some((yard) => yard.code === code) ||
        (url !== BYOT_ARRIVALS_URL &&
          !BYOT_QUERIES.some((_, index) => byotSearchUrl(code, index) === url))
      )
        return Effect.fail(
          ByotResult.error(
            "request destination",
            "URL or location header is outside the qualified native yard/search controls: " +
              url,
          ),
        );
      const lifetime = new AbortController();
      const deadline = AbortSignal.timeout(BYOT_REQUEST_TIMEOUT_MS);
      let pending: Promise<string> | null = null;
      return Effect.tryPromise({
        try: (interrupted) => {
          pending = document(
            url,
            code,
            AbortSignal.any([lifetime.signal, interrupted, deadline]),
          );
          return pending;
        },
        catch: (cause) =>
          ByotResult.error(
            "request/body " + url,
            cause instanceof Error ? cause.message : String(cause),
          ),
      }).pipe(
        Effect.ensuring(
          Effect.promise(async () => {
            lifetime.abort();
            // Await release after interruption; preserve the request's original error.
            if (pending)
              await pending.then(
                () => undefined,
                () => undefined,
              );
          }),
        ),
        Effect.timeoutFail({
          duration: "45 seconds",
          onTimeout: () =>
            ByotResult.error(
              "request/body " + url,
              "Combined request and body deadline exceeded 45 seconds",
            ),
        }),
      );
    }),
  );
}
