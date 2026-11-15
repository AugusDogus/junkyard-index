import { Data, Effect } from "effect";
import type { ProviderRequestGate } from "./provider-http-client";
import { readIPullUPullResponseText } from "./ipullupull-response-text";
import {
  SCOTTS_MAKES,
  SCOTTS_ROOT,
  scottsBrowsePath,
} from "./scotts-yard-metadata";

export class ScottsProviderError extends Data.TaggedError(
  "ScottsProviderError",
)<{
  operation: string;
  cause: unknown;
}> {
  override get message() {
    const detail =
      this.cause instanceof Error ? this.cause.message : String(this.cause);
    return `Scotts ${this.operation}: ${detail}. No advanced checkpoint was accepted; prior inventory is preserved. Inspect the native source and resume only from the last validated checkpoint.`;
  }
}

async function readScottsDocument(
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
      "Expected complete unredirected Scotts HTTP200 text/html, received " +
        response.status,
    );
    try {
      if (response.body) await response.body.cancel();
    } catch (cleanup) {
      throw new AggregateError(
        [refusal, cleanup],
        refusal.message +
          "; cancelling its unread response body also failed. Inspect both failures before resuming.",
      );
    }
    throw refusal;
  }
  return await readIPullUPullResponseText(
    response,
    "Scotts " + url,
    signal,
    2 * 1024 * 1024,
  );
}

export function fetchScottsPage(url: string, gate: ProviderRequestGate) {
  return gate(
    Effect.suspend(() => {
      if (
        ![SCOTTS_ROOT, SCOTTS_MAKES].includes(url) &&
        !scottsBrowsePath(url, 1) &&
        !scottsBrowsePath(url, 2)
      )
        return Effect.fail(
          new Error("Destination is outside the finite Scotts browse graph"),
        );
      const lifetime = new AbortController();
      const deadline = AbortSignal.timeout(20_000);
      let pending: Promise<string> | null = null;
      return Effect.tryPromise({
        try: (interruption) => {
          pending = readScottsDocument(
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
            // The request effect owns its failure. Cleanup awaits transport/body
            // release on interruption without replacing that original failure.
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
      (cause) => new ScottsProviderError({ operation: url, cause }),
    ),
  );
}
