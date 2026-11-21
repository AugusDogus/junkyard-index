import { Data, Effect } from "effect";
import type { ProviderRequestGate } from "./provider-http-client";
import { readIPullUPullResponseText } from "./ipullupull-response-text";
import { DocumentTransport } from "./document-transport";
import {
  SIX03_CATALOG,
  SIX03_CONTACT,
  six03DonorPath,
} from "./six03-yard-metadata";

export class Six03ProviderError extends Data.TaggedError("Six03ProviderError")<{
  operation: string;
  cause: unknown;
}> {
  override get message() {
    const detail =
      this.cause instanceof Error ? this.cause.message : String(this.cause);
    return `Six03 ${this.operation}: ${detail}. No advanced checkpoint was accepted; prior inventory is preserved. Inspect the native source and resume only from the last validated checkpoint.`;
  }
}

async function readSix03Document(
  url: string,
  signal: AbortSignal,
  transport: DocumentTransport,
): Promise<string> {
  const response = await transport(url, {
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
      "Expected complete unredirected Six03 HTTP200 text/html, received " +
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
    "Six03 " + url,
    signal,
    2 * 1024 * 1024,
  );
}

export function fetchSix03Page(
  url: string,
  gate: ProviderRequestGate,
  transport: DocumentTransport = DocumentTransport.native,
) {
  return gate(
    Effect.suspend(() => {
      if (![SIX03_CATALOG, SIX03_CONTACT].includes(url) && !six03DonorPath(url))
        return Effect.fail(
          new Error("Destination is outside the finite Six03 browse graph"),
        );
      const lifetime = new AbortController();
      const deadline = AbortSignal.timeout(20_000);
      let pending: Promise<string> | null = null;
      return Effect.tryPromise({
        try: (interruption) => {
          pending = readSix03Document(
            url,
            AbortSignal.any([lifetime.signal, interruption, deadline]),
            transport,
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
      (cause) => new Six03ProviderError({ operation: url, cause }),
    ),
  );
}

/** Cloudflare refuses native requests from Vercel, so a browser session
 * navigates once and reads later documents by same-origin fetch. */
export const acquireSix03Browser = (apiKey: string) =>
  DocumentTransport.acquireBrowser(apiKey, "fetch");
