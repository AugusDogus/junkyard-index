import { ingestionValidation } from "./ingestion-validation";
import { Data, Effect } from "effect";
import { readIPullUPullResponseText } from "./ipullupull-response-text";
import type { ProviderRequestGate } from "./provider-http-client";
import { hasHttpPaginationLink } from "./provider-http-pagination";
import {
  HAGERMAN_CATALOG_URL,
  HAGERMAN_PROFILE_URL,
  HagermanCatalog,
} from "./hagerman-parser";

export class HagermanProviderError extends Data.TaggedError(
  "HagermanProviderError",
)<{
  operation: string;
  cause: unknown;
}> {
  override get message() {
    const reason =
      this.cause instanceof Error ? this.cause.message : String(this.cause);
    return `Hagerman ${this.operation}: ${reason}. Prior inventory is preserved. Inspect the native failure and resume from the last successfully staged checkpoint.`;
  }
}
export const hagermanValidated = <A>(operation: string, run: () => A) =>
  ingestionValidation({
    try: run,
    catch: (cause) => new HagermanProviderError({ operation, cause }),
  });
export const HAGERMAN_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

const serial = Effect.runSync(Effect.makeSemaphore(1));
/** Shared across chunks. Cleanup and the completed-request gap retain the permit. */
export const hagermanRequestGate: ProviderRequestGate = (request) =>
  serial.withPermits(1)(
    request.pipe(Effect.ensuring(Effect.sleep("2500 millis"))),
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
    hasHttpPaginationLink(response.headers) ||
    response.headers
      .get("content-type")
      ?.split(";")[0]
      ?.trim()
      .toLowerCase() !== "text/html"
  ) {
    const failure = new Error(
      `Expected complete unredirected HTTP 200 HTML from ${url}; received ${response.status}`,
    );
    try {
      await response.body?.cancel();
    } catch (cleanup) {
      throw new AggregateError(
        [failure, cleanup],
        "Refused Hagerman response and unread-body cancellation both failed",
      );
    }
    throw failure;
  }
  return readIPullUPullResponseText(
    response,
    "Hagerman " + url,
    signal,
    HAGERMAN_MAX_RESPONSE_BYTES,
  );
}

export function fetchHagermanPage(
  url: string,
  gate: ProviderRequestGate,
): Effect.Effect<string, HagermanProviderError> {
  if (
    url !== HAGERMAN_CATALOG_URL &&
    url !== HAGERMAN_PROFILE_URL &&
    HagermanCatalog.donorId(url) === null
  )
    return Effect.fail(
      new HagermanProviderError({
        operation: "destination",
        cause: "URL is outside the published Hagerman native donor scope",
      }),
    );
  return gate(
    Effect.suspend(() => {
      const lifetime = new AbortController();
      const deadline = AbortSignal.timeout(20_000);
      let pending: Promise<string> | null = null;
      return Effect.tryPromise({
        try: (interruption) => {
          pending = document(
            url,
            AbortSignal.any([lifetime.signal, deadline, interruption]),
          );
          return pending;
        },
        catch: (cause) => cause,
      }).pipe(
        Effect.ensuring(
          Effect.promise(async () => {
            lifetime.abort();
            // Interruption must not release the host while transport/body cleanup runs.
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
            new Error(
              "Combined Hagerman request and complete-body deadline exceeded 20 seconds",
            ),
        }),
      );
    }),
  ).pipe(
    Effect.mapError(
      (cause) => new HagermanProviderError({ operation: url, cause }),
    ),
  );
}
