import { sharedProviderHostSlot } from "./shared-provider-host";
import { Data, Effect } from "effect";
import { BrowserSessionError } from "./errors";
import { ProviderChunkClock } from "./provider-chunk-clock";
import type { ProviderRequestGate } from "./provider-http-client";
import { readIPullUPullResponseText } from "./ipullupull-response-text";
import {
  DocumentTransport,
  type BrowserSessions,
  type LazyDocumentTransport,
} from "./document-transport";
import {
  NORTHWEST_MAKES,
  NORTHWEST_ROOT,
  northwestBrowsePath,
} from "./northwest-yard-metadata";

export class NorthwestProviderError extends Data.TaggedError(
  "NorthwestProviderError",
)<{
  operation: string;
  cause: unknown;
}> {
  override get message() {
    const detail =
      this.cause instanceof Error ? this.cause.message : String(this.cause);
    return `Northwest ${this.operation}: ${detail}. No advanced checkpoint was accepted; prior inventory is preserved. Inspect the native source and resume only from the last validated checkpoint.`;
  }
}

async function readNorthwestDocument(
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
      "Expected complete unredirected Northwest HTTP200 text/html, received " +
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
    "Northwest " + url,
    signal,
    2 * 1024 * 1024,
  );
}

/** Native requests, with no lease or session. */
export const NORTHWEST_NATIVE_TRANSPORT: LazyDocumentTransport =
  DocumentTransport.nativeLazy;

/** One Northwest document inside its request gate and URG host slot. The
 * transport is resolved there too, so a browser session opens inside the slot
 * and no caller ever holds a raw transport it could call outside one. Lease,
 * session and deferral failures pass through as they are. */
export function fetchNorthwestPage(
  url: string,
  gate: ProviderRequestGate,
  transport: LazyDocumentTransport = NORTHWEST_NATIVE_TRANSPORT,
) {
  return gate(
    Effect.suspend(() => {
      if (
        ![NORTHWEST_ROOT, NORTHWEST_MAKES].includes(url) &&
        !northwestBrowsePath(url, 1) &&
        !northwestBrowsePath(url, 2)
      )
        return Effect.fail(
          new NorthwestProviderError({
            operation: url,
            cause: new Error(
              "Destination is outside the finite Northwest browse graph",
            ),
          }),
        );
      return transport.open.pipe(
        Effect.flatMap((documents) => readNorthwestPage(url, documents)),
      );
    }),
  ).pipe(
    sharedProviderHostSlot(url),
    Effect.mapError((cause) =>
      cause instanceof NorthwestProviderError ||
      cause instanceof BrowserSessionError ||
      ProviderChunkClock.isDeferral(cause)
        ? cause
        : new NorthwestProviderError({ operation: url, cause }),
    ),
  );
}

function readNorthwestPage(url: string, transport: DocumentTransport) {
  const lifetime = new AbortController();
  const deadline = AbortSignal.timeout(20_000);
  let pending: Promise<string> | null = null;
  return Effect.tryPromise({
    try: (interruption) => {
      pending = readNorthwestDocument(
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
    Effect.mapError(
      (cause) => new NorthwestProviderError({ operation: url, cause }),
    ),
  );
}

// Match Central's post-completion URG pacing, with one request at a time.
export const northwestRequestGate: ProviderRequestGate = (request) =>
  request.pipe(Effect.ensuring(Effect.sleep("1600 millis")));

/** Cloudflare refuses native requests from Vercel, so a browser session
 * navigates once and reads later documents by same-origin fetch. The
 * transports live here, beside the host slot every Northwest request takes,
 * so the connector's URG turns only reach them through `fetchNorthwestPage`,
 * which also resolves them. */
export const acquireNorthwestBrowser = (sessions: BrowserSessions) =>
  DocumentTransport.acquireBrowser(sessions, "fetch");

/** Northwest's Hyperbrowser sessions, under the session lease. Northwest is a
 * URG lane, and the URG plugin's own requests are what the lane meters, so
 * its pages load no subresources that reach the site. */
export const northwestHyperbrowser = (apiKey: string) =>
  DocumentTransport.hyperbrowser(apiKey, "northwest", "none");
