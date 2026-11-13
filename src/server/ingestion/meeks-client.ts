import { Data, Effect } from "effect";
import { readIPullUPullResponseText } from "./ipullupull-response-text";
import { MEEKS_ORIGIN } from "./meeks-yard-metadata";
import type { ProviderRequestGate } from "./provider-http-client";

export class MeeksProviderError extends Data.TaggedError("MeeksProviderError")<{
  operation: string;
  cause: unknown;
}> {
  override get message() {
    return (
      "Meeks " +
      this.operation +
      ": " +
      (this.cause instanceof Error ? this.cause.message : String(this.cause)) +
      ". Reconciliation is blocked and previous inventory is preserved. Inspect both native inventory views before retrying the start checkpoint."
    );
  }
}

async function readMeeksDocument(
  url: string,
  signal: AbortSignal,
): Promise<string> {
  const response = await fetch(url, {
    method: "GET",
    redirect: "manual",
    signal,
    headers: { "User-Agent": "JunkyardIndex/1.0", Accept: "text/html" },
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
    const failure = new Error(
      "Expected complete unredirected Meeks HTTP200 text/html, received " +
        response.status,
    );
    try {
      await response.body?.cancel();
    } catch (cleanupFailure) {
      throw new AggregateError(
        [failure, cleanupFailure],
        failure.message + "; unread response body cancellation also failed",
      );
    }
    throw failure;
  }
  return readIPullUPullResponseText(
    response,
    "Meeks " + url,
    signal,
    2 * 1024 * 1024,
  );
}

export function fetchMeeksPage(
  path: "/" | "/pic-and-pull/" | "/pic-and-pull-inventory/",
  gate: ProviderRequestGate,
) {
  return gate(
    Effect.suspend(() => {
      if (!["/", "/pic-and-pull/", "/pic-and-pull-inventory/"].includes(path))
        return Effect.fail(
          new Error(
            "Destination is outside the finite Meeks owner and inventory graph",
          ),
        );
      const lifetime = new AbortController();
      const deadline = AbortSignal.timeout(20_000);
      let pending: Promise<string> | null = null;
      return Effect.tryPromise({
        try: (interruption) => {
          pending = readMeeksDocument(
            MEEKS_ORIGIN + path,
            AbortSignal.any([lifetime.signal, interruption, deadline]),
          );
          return pending;
        },
        catch: (cause) => cause,
      }).pipe(
        Effect.ensuring(
          Effect.promise(async () => {
            lifetime.abort();
            // Preserve the request failure while awaiting transport/body release.
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
              "Meeks request exceeded its 20-second header and body budget",
            ),
        }),
      );
    }),
  ).pipe(
    Effect.mapError(
      (cause) => new MeeksProviderError({ operation: path, cause }),
    ),
  );
}
