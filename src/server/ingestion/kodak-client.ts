import { Data, Effect } from "effect";
import { readIPullUPullResponseText } from "./ipullupull-response-text";
import { KODAK_MAX_RESPONSE_BYTES } from "./kodak-parser";
import type { ProviderRequestGate } from "./provider-http-client";
import { KODAK_HOME, KODAK_INVENTORY } from "./kodak-yard-metadata";

export class KodakProviderError extends Data.TaggedError("KodakProviderError")<{
  operation: string;
  cause: unknown;
}> {
  override get message() {
    const detail =
      this.cause instanceof Error ? this.cause.message : String(this.cause);
    return `Kodak ${this.operation}: ${detail}. No advanced checkpoint or complete inventory was accepted. Previous inventory is preserved; inspect the native source before resuming.`;
  }
}

async function readKodakDocument(
  url: string,
  signal: AbortSignal,
): Promise<string> {
  const response = await fetch(url, {
    method: "GET",
    redirect: "manual",
    signal,
    headers: { "User-Agent": "Mozilla/5.0", Accept: "text/html" },
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
    const refusal = new Error(
      `Expected complete unredirected Kodak HTTP200 text/html, received ${response.status}`,
    );
    try {
      await response.body?.cancel();
    } catch (cleanup) {
      const detail =
        cleanup instanceof Error ? cleanup.message : String(cleanup);
      throw new AggregateError(
        [refusal, cleanup],
        refusal.message +
          "; unread response body cancellation also failed: " +
          detail,
        { cause: refusal },
      );
    }
    throw refusal;
  }
  return readIPullUPullResponseText(
    response,
    "Kodak " + url,
    signal,
    KODAK_MAX_RESPONSE_BYTES,
  );
}

export function fetchKodakPage(url: string, gate: ProviderRequestGate) {
  return gate(
    Effect.suspend(() => {
      if (url !== KODAK_HOME && url !== KODAK_INVENTORY)
        return Effect.fail(
          new Error("Destination is outside the two inspected Kodak pages"),
        );
      const lifetime = new AbortController();
      const deadline = AbortSignal.timeout(20_000);
      let pending: Promise<string> | null = null;
      return Effect.tryPromise({
        try: (interruption) => {
          pending = readKodakDocument(
            url,
            AbortSignal.any([lifetime.signal, interruption, deadline]),
          );
          return pending;
        },
        catch: (cause) => cause,
      }).pipe(
        Effect.ensuring(
          Effect.promise(async () => {
            lifetime.abort();
            // The request owns its failure. Await cleanup on interruption
            // without replacing the original transport or body error.
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
            new Error("Combined request/body deadline exceeded 20 seconds"),
        }),
      );
    }),
  ).pipe(
    Effect.mapError(
      (cause) => new KodakProviderError({ operation: url, cause }),
    ),
  );
}
