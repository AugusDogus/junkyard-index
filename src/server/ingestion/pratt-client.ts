import { Effect } from "effect";
import { readIPullUPullResponseText } from "./ipullupull-response-text";
import type { ProviderRequestGate } from "./provider-http-client";
import {
  PRATT_ARRIVALS,
  PRATT_MAKES,
  PRATT_ORIGIN,
  prattBrowsePath,
} from "./pratt-html";
import { PrattResult } from "./pratt-result";

export const PRATT_REQUEST_TIMEOUT_MS = 20_000;
export const PRATT_MAX_BODY_BYTES = 2 * 1024 * 1024;
const serial = Effect.runSync(Effect.makeSemaphore(1));
/** Hold the permit through body completion and padding, including failures.
 * Module scope preserves the gap across consecutive connector chunks. */
export const prattRequestGate: ProviderRequestGate = (request) =>
  serial.withPermits(1)(
    request.pipe(Effect.ensuring(Effect.sleep("1600 millis"))),
  );

async function document(url: string, signal: AbortSignal): Promise<string> {
  const response = await fetch(url, {
    method: "GET",
    redirect: "manual",
    signal,
    headers: { "User-Agent": "JunkyardIndex/1.0", Accept: "text/html" },
  });
  if (
    response.status !== 200 ||
    response.redirected ||
    (response.url && response.url !== url) ||
    response.headers.has("content-range") ||
    response.headers
      .get("content-type")
      ?.split(";")[0]
      ?.trim()
      .toLowerCase() !== "text/html"
  ) {
    const failure = new Error(
      `Expected complete owned HTTP200 text/html at ${url}; received HTTP${response.status}`,
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
    "Pratt " + url,
    signal,
    PRATT_MAX_BODY_BYTES,
  );
}

/** Direct fetch is intentional: the shared response helper does not propagate
 * Effect interruption into its fetch signal. The shared bounded body reader is
 * reused while this adapter owns one request/body lifetime with no retry. */
export function readPrattPage(
  url: string,
  gate: ProviderRequestGate = prattRequestGate,
) {
  return gate(
    Effect.suspend(() => {
      if (
        URL.parse(url)?.href !== url ||
        (![PRATT_ORIGIN + "/", PRATT_ARRIVALS, PRATT_MAKES].includes(url) &&
          !prattBrowsePath(url, 1) &&
          !prattBrowsePath(url, 2))
      )
        return Effect.fail(
          PrattResult.error(
            "request destination",
            "URL is outside the literal owned native root/make/model graph: " +
              url,
          ),
        );
      const lifetime = new AbortController();
      const deadline = AbortSignal.timeout(PRATT_REQUEST_TIMEOUT_MS);
      let pending: Promise<string> | null = null;
      return Effect.tryPromise({
        try: (interrupted) => {
          pending = document(
            url,
            AbortSignal.any([lifetime.signal, interrupted, deadline]),
          );
          return pending;
        },
        catch: (cause) =>
          PrattResult.error(
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
          duration: "20 seconds",
          onTimeout: () =>
            PrattResult.error(
              "request/body " + url,
              "Combined request and body deadline exceeded 20 seconds",
            ),
        }),
      );
    }),
  );
}
