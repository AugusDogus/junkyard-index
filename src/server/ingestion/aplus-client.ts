import { Data, Effect } from "effect";
import type { ProviderRequestGate } from "./provider-http-client";
import { readIPullUPullResponseText } from "./ipullupull-response-text";
import {
  APLUS_CONTACT,
  APLUS_MAKES,
  APLUS_ROOT,
  aplusBrowsePath,
} from "./aplus-yard-metadata";

export class AplusProviderError extends Data.TaggedError("AplusProviderError")<{
  operation: string;
  cause: unknown;
}> {
  override get message() {
    const detail =
      this.cause instanceof Error ? this.cause.message : String(this.cause);
    return `Aplus ${this.operation}: ${detail}. No advanced checkpoint was accepted; prior inventory is preserved. Inspect the native source and resume only from the last validated checkpoint.`;
  }
}

async function readAplusDocument(
  url: string,
  signal: AbortSignal,
): Promise<string> {
  const response = await fetch(url, {
    method: "GET",
    redirect: "manual",
    signal,
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      Accept: "application/json,text/html;q=0.9,*/*;q=0.8",
    },
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
      "Expected complete unredirected Aplus HTTP200 text/html, received " +
        response.status,
    );
    try {
      await response.body?.cancel();
    } catch (cleanupFailure) {
      throw new AggregateError(
        [failure, cleanupFailure],
        failure.message + "; unread response body cancellation also failed",
        { cause: failure },
      );
    }
    throw failure;
  }
  return readIPullUPullResponseText(
    response,
    "Aplus " + url,
    signal,
    2 * 1024 * 1024,
  );
}

export function fetchAplusPage(url: string, gate: ProviderRequestGate) {
  return gate(
    Effect.suspend(() => {
      if (
        ![APLUS_ROOT, APLUS_CONTACT, APLUS_MAKES].includes(url) &&
        !aplusBrowsePath(url, 1) &&
        !aplusBrowsePath(url, 2)
      )
        return Effect.fail(
          new Error("Destination is outside the finite Aplus browse graph"),
        );
      const lifetime = new AbortController();
      const deadline = AbortSignal.timeout(20_000);
      let pending: Promise<string> | null = null;
      return Effect.tryPromise({
        try: (interruption) => {
          pending = readAplusDocument(
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
            // The request effect owns its failure. Await resource release on
            // interruption without replacing that original failure.
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
      (cause) => new AplusProviderError({ operation: url, cause }),
    ),
  );
}
