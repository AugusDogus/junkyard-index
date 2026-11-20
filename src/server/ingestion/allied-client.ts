import { sharedProviderHostSlot } from "./shared-provider-host";
import { Effect } from "effect";
import { readIPullUPullResponseText } from "./ipullupull-response-text";
import type { ProviderRequestGate } from "./provider-http-client";
import {
  ALLIED_ARRIVALS,
  ALLIED_MAKES,
  ALLIED_ORIGIN,
  alliedBrowsePath,
} from "./allied-html";
import { ALLIED_LITERAL_PARENTHESIS_ROUTES } from "./allied-configuration";
import { AlliedResult } from "./allied-result";

export const ALLIED_REQUEST_TIMEOUT_MS = 45_000;
export const ALLIED_MAX_BODY_BYTES = 2 * 1024 * 1024;
const serial = Effect.runSync(Effect.makeSemaphore(1));
/** Hold the permit through body completion and padding, including failures.
 * Module scope preserves the gap across consecutive connector chunks. */
export const alliedRequestGate: ProviderRequestGate = (request) =>
  serial.withPermits(1)(
    request.pipe(Effect.ensuring(Effect.sleep("2000 millis"))),
  );

async function document(url: string, signal: AbortSignal): Promise<string> {
  // Published controls stay literal in state. Parentheses are encoded on the
  // wire except on routes probed to list donors only when sent literally.
  const wireUrl = ALLIED_LITERAL_PARENTHESIS_ROUTES.has(new URL(url).pathname)
    ? url
    : url.replaceAll("(", "%28").replaceAll(")", "%29");
  const response = await fetch(wireUrl, {
    method: "GET",
    redirect: "manual",
    signal,
    headers: {
      "User-Agent":
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      Referer: ALLIED_MAKES,
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
    "Allied " + url,
    signal,
    ALLIED_MAX_BODY_BYTES,
  );
}

/** Direct fetch is intentional: the shared response helper does not propagate
 * Effect interruption into its fetch signal. The shared bounded body reader is
 * reused while this adapter owns one request/body lifetime with no retry. */
export function readAlliedPage(
  url: string,
  gate: ProviderRequestGate = alliedRequestGate,
) {
  return gate(
    Effect.suspend(() => {
      if (
        URL.parse(url)?.href !== url ||
        (![ALLIED_ORIGIN + "/", ALLIED_ARRIVALS, ALLIED_MAKES].includes(url) &&
          !alliedBrowsePath(url, 1) &&
          !alliedBrowsePath(url, 2))
      )
        return Effect.fail(
          AlliedResult.error(
            "request destination",
            "URL is outside the literal owned native root/make/model graph: " +
              url,
          ),
        );
      const lifetime = new AbortController();
      const deadline = AbortSignal.timeout(ALLIED_REQUEST_TIMEOUT_MS);
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
          AlliedResult.error(
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
            AlliedResult.error(
              "request/body " + url,
              "Combined request and body deadline exceeded 45 seconds",
            ),
        }),
      );
    }),
  ).pipe(
    sharedProviderHostSlot(url),
    Effect.mapError((cause) =>
      cause instanceof Error
        ? AlliedResult.error("shared host " + url, cause.message)
        : cause,
    ),
  );
}
