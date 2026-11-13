import { Data, Effect } from "effect";
import type { ProviderRequestGate } from "./provider-http-client";
import { readIPullUPullResponseText } from "./ipullupull-response-text";
import {
  CENTRAL_MAKES,
  CENTRAL_ROOT,
  centralBrowsePath,
} from "./central-yard-metadata";

export class CentralProviderError extends Data.TaggedError(
  "CentralProviderError",
)<{
  operation: string;
  cause: unknown;
}> {
  override get message() {
    const detail =
      this.cause instanceof Error ? this.cause.message : String(this.cause);
    return `Central ${this.operation}: ${detail}. No advanced checkpoint was accepted; prior inventory is preserved. Inspect the native source and resume only from the last validated checkpoint.`;
  }
}

async function readCentralDocument(
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
      "Expected complete unredirected Central HTTP200 text/html, received " +
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
    "Central " + url,
    signal,
    2 * 1024 * 1024,
  );
}

export function fetchCentralPage(url: string, gate: ProviderRequestGate) {
  return gate(
    Effect.suspend(() => {
      if (
        ![CENTRAL_ROOT, CENTRAL_MAKES].includes(url) &&
        !centralBrowsePath(url, 1) &&
        !centralBrowsePath(url, 2)
      )
        return Effect.fail(
          new Error("Destination is outside the finite Central browse graph"),
        );
      const lifetime = new AbortController();
      const deadline = AbortSignal.timeout(20_000);
      let pending: Promise<string> | null = null;
      return Effect.tryPromise({
        try: (interruption) => {
          pending = readCentralDocument(
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
      (cause) => new CentralProviderError({ operation: url, cause }),
    ),
  );
}
