import { Data, Effect } from "effect";
import type { ProviderRequestGate } from "./provider-http-client";
import { httpDocumentFetch, type DocumentFetch } from "./document-fetch";
import {
  IPULLUPULL_MAX_RESPONSE_BYTES,
  readIPullUPullResponseText,
} from "./ipullupull-response-text";
import {
  SIX03_CATALOG,
  SIX03_CONTACT,
  six03RestPage,
  six03RestPageUrl,
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

type Six03Media = "text/html" | "application/json";
const SIX03_HTML_MAX_BYTES = 2 * 1024 * 1024;
/** A 100-donor REST page decodes to at most 3.4 MB (Nov 2026); the shared
 * reader's 4 MiB ceiling leaves about a fifth for longer articles. */
const SIX03_REST_MAX_BYTES = IPULLUPULL_MAX_RESPONSE_BYTES;

async function readSix03Document(
  url: string,
  signal: AbortSignal,
  fetchDocument: DocumentFetch,
  media: Six03Media,
): Promise<{ text: string; headers: Headers }> {
  const response = await fetchDocument(url, {
    method: "GET",
    redirect: "manual",
    signal,
    headers: { "User-Agent": "Mozilla/5.0", Accept: media },
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
      .toLowerCase() !== media
  ) {
    const refusal = new Error(
      `Expected complete unredirected Six03 HTTP200 ${media}, received ` +
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
  return {
    headers: response.headers,
    text: await readIPullUPullResponseText(
      response,
      "Six03 " + url,
      signal,
      media === "text/html" ? SIX03_HTML_MAX_BYTES : SIX03_REST_MAX_BYTES,
    ),
  };
}

function fetchSix03(
  url: string,
  media: Six03Media,
  gate: ProviderRequestGate,
  fetchDocument: DocumentFetch,
) {
  return gate(
    Effect.suspend(() => {
      const allowed =
        media === "text/html"
          ? [SIX03_CATALOG, SIX03_CONTACT].includes(url)
          : six03RestPage(url) !== null;
      if (!allowed)
        return Effect.fail(
          new Error("Destination is outside the finite Six03 browse graph"),
        );
      const lifetime = new AbortController();
      const deadline = AbortSignal.timeout(20_000);
      let pending: Promise<{ text: string; headers: Headers }> | null = null;
      return Effect.tryPromise({
        try: (interruption) => {
          pending = readSix03Document(
            url,
            AbortSignal.any([lifetime.signal, interruption, deadline]),
            fetchDocument,
            media,
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

/** The contact or catalog page. */
export function fetchSix03Page(
  url: string,
  gate: ProviderRequestGate,
  fetchDocument: DocumentFetch = httpDocumentFetch,
) {
  return fetchSix03(url, "text/html", gate, fetchDocument).pipe(
    Effect.map(({ text }) => text),
  );
}

export interface Six03RestResponse {
  body: string;
  /** WordPress's X-WP-Total and X-WP-TotalPages for the whole collection. */
  total: number;
  totalPages: number;
}

/** One page of the donor REST collection, with its census headers. */
export function fetchSix03RestPage(
  page: number,
  gate: ProviderRequestGate,
  fetchDocument: DocumentFetch = httpDocumentFetch,
) {
  return Effect.try({
    try: () => six03RestPageUrl(page),
    catch: (cause) =>
      new Six03ProviderError({ operation: `REST page ${page}`, cause }),
  }).pipe(
    Effect.flatMap((url) =>
      fetchSix03(url, "application/json", gate, fetchDocument).pipe(
        Effect.flatMap(({ text, headers }) => {
          const total = headers.get("x-wp-total") ?? "";
          const totalPages = headers.get("x-wp-totalpages") ?? "";
          return /^\d{1,6}$/.test(total) && /^\d{1,4}$/.test(totalPages)
            ? Effect.succeed<Six03RestResponse>({
                body: text,
                total: Number(total),
                totalPages: Number(totalPages),
              })
            : Effect.fail(
                new Six03ProviderError({
                  operation: url,
                  cause: `WordPress census headers are missing or malformed (X-WP-Total ${JSON.stringify(total)}, X-WP-TotalPages ${JSON.stringify(totalPages)})`,
                }),
              );
        }),
      ),
    ),
  );
}
