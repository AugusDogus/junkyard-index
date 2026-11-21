import { ingestionValidation } from "./ingestion-validation";
import { Data, Effect } from "effect";
import { ProviderRequestError, RetryableHttpStatusError } from "./errors";
import { readIPullUPullResponseText } from "./ipullupull-response-text";
import {
  fetchProviderResponse,
  parseRetryAfterMs,
  type ProviderRequestGate,
} from "./provider-http-client";
import type { TruckPartsCatalogRecord } from "./truck-parts-catalog";
import {
  WHITEBRADSTREET_MAX_PAGES,
  WHITEBRADSTREET_RATE_LIMIT_COOLDOWNS_MS,
} from "./whitebradstreet-cursor";
import {
  parseWhitebradstreetControl,
  parseWhitebradstreetPage,
} from "./whitebradstreet-parser";
import { WHITEBRADSTREET_CATALOG } from "./whitebradstreet-yard-metadata";

export class WhitebradstreetProviderError extends Data.TaggedError(
  "WhitebradstreetProviderError",
)<{
  operation: string;
  cause: unknown;
}> {
  override get message() {
    return (
      "White & Bradstreet " +
      this.operation +
      ": " +
      (this.cause instanceof Error ? this.cause.message : String(this.cause)) +
      ". No advanced checkpoint accepted. Previously published inventory is preserved; inspect the native response and retry the last validated checkpoint."
    );
  }
}

/**
 * The Cloudflare edge answers bursts with HTTP 429. Each paced attempt passes
 * the request gate again, so a retried page still respects the crawl pacing.
 * A longer requested wait, or a 429 on every attempt, fails with
 * WhitebradstreetRateLimitedError so the connector defers to a durable wait.
 */
const RATE_LIMITED = 429;
const MAX_IN_CHUNK_RETRY_AFTER_MS = 60_000;
const IN_CHUNK_RETRIES = 2;

/** The Cloudflare edge still answers HTTP 429 after the in-chunk retries, or
 * asked for a longer wait than one chunk spends. The connector checkpoints
 * and the durable Workflow sleeps before any further request. */
export class WhitebradstreetRateLimitedError extends Data.TaggedError(
  "WhitebradstreetRateLimitedError",
)<{
  url: string;
  reason: "long-retry-after" | "retries-exhausted" | "chunk-deadline";
  retryAfterMs: number;
}> {
  override get message() {
    const wait =
      this.retryAfterMs > 0
        ? " with Retry-After " + Math.ceil(this.retryAfterMs / 1_000) + "s"
        : "";
    return (
      "White & Bradstreet host rate-limited " +
      this.url +
      " (HTTP 429" +
      wait +
      ")" +
      (this.reason === "retries-exhausted"
        ? " on all " + (IN_CHUNK_RETRIES + 1) + " paced attempts"
        : this.reason === "chunk-deadline"
          ? " and its in-chunk waits used up the crawl deadline"
          : ", longer than the " +
            MAX_IN_CHUNK_RETRY_AFTER_MS / 1_000 +
            "-second in-chunk wait") +
      ". Previously published inventory is preserved; the crawl pauses at its last validated checkpoint and resumes after a cooldown."
    );
  }
}

/** The host kept rate-limiting after every durable cooldown this crawl may
 * spend, so the run stops instead of deferring again. */
export class WhitebradstreetRateLimitExhaustedError extends Data.TaggedError(
  "WhitebradstreetRateLimitExhaustedError",
)<{
  url: string;
  retryAfterMs: number;
  bound: "cooldowns" | "window";
  since: number;
}> {
  override get message() {
    const wait =
      this.retryAfterMs > 0
        ? ", Retry-After " + Math.ceil(this.retryAfterMs / 1_000) + "s"
        : "";
    return (
      "White & Bradstreet host still rate-limits " +
      this.url +
      " (HTTP 429" +
      wait +
      ") " +
      (this.bound === "cooldowns"
        ? "after " +
          WHITEBRADSTREET_RATE_LIMIT_COOLDOWNS_MS.length +
          " cooldowns in a row without progress"
        : "and the next cooldown would end more than an hour after the first one at " +
          new Date(this.since).toISOString()) +
      ", so the run stops without publishing. Previously published inventory is preserved. The next scheduled crawl starts from the beginning; if it is rate-limited again, check whether white-bradstreet.com now blocks this client."
    );
  }
}

/** Reports every HTTP 429 the host answers, including ones retried in-chunk. */
export type WhitebradstreetRateLimitObserver = (
  url: string,
  retryAfterMs: number,
) => void;

function read(
  url: string,
  gate: ProviderRequestGate,
  onRateLimited: WhitebradstreetRateLimitObserver,
) {
  return Effect.gen(function* () {
    const response = yield* fetchProviderResponse({
      url,
      context: "White & Bradstreet " + url,
      requestGate: gate,
      retry: {
        timeoutMs: 20_000,
        retryLimit: IN_CHUNK_RETRIES,
        retryBaseDelayMs: 15_000,
        retryableStatusCodes: [RATE_LIMITED],
        retryNetworkErrors: false,
        jitter: false,
      },
      onResponse: (response) => {
        if (response.status === RATE_LIMITED) {
          const waitMs = parseRetryAfterMs(
            response.headers.get("retry-after"),
            Date.now(),
          );
          onRateLimited(url, waitMs);
          if (waitMs > MAX_IN_CHUNK_RETRY_AFTER_MS)
            throw new WhitebradstreetRateLimitedError({
              url,
              reason: "long-retry-after",
              retryAfterMs: waitMs,
            });
          return;
        }
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
        )
          throw new Error(
            "Expected complete HTTP 200 text/html from the native endpoint, received HTTP " +
              response.status,
          );
      },
    });
    return yield* Effect.tryPromise({
      try: () =>
        readIPullUPullResponseText(
          response,
          "White & Bradstreet HTML",
          AbortSignal.timeout(20_000),
        ),
      catch: (cause) => cause,
    });
  }).pipe(
    Effect.mapError((cause) => {
      if (
        cause instanceof ProviderRequestError &&
        cause.cause instanceof WhitebradstreetRateLimitedError
      )
        return cause.cause;
      if (
        cause instanceof RetryableHttpStatusError &&
        cause.status === RATE_LIMITED
      )
        return new WhitebradstreetRateLimitedError({
          url,
          reason: "retries-exhausted",
          retryAfterMs: cause.retryAfterMs,
        });
      return new WhitebradstreetProviderError({ operation: url, cause });
    }),
  );
}

export function fetchWhitebradstreetPage(
  page: number,
  gate: ProviderRequestGate,
  onRateLimited: WhitebradstreetRateLimitObserver,
) {
  return Effect.gen(function* () {
    if (
      !Number.isSafeInteger(page) ||
      page < 1 ||
      page > WHITEBRADSTREET_MAX_PAGES
    )
      return yield* new WhitebradstreetProviderError({
        operation: "page budget",
        cause: "Expected native page from 1 to " + WHITEBRADSTREET_MAX_PAGES,
      });
    const url =
      WHITEBRADSTREET_CATALOG.origin +
      WHITEBRADSTREET_CATALOG.listPath +
      "?f-condition=nw" +
      (page === 1 ? "" : "&page_number=" + page);
    const raw = yield* read(url, gate, onRateLimited);
    return yield* ingestionValidation({
      try: () => parseWhitebradstreetPage(raw, page),
      catch: (cause) =>
        new WhitebradstreetProviderError({
          operation: "native page " + page,
          cause,
        }),
    });
  });
}

export function fetchWhitebradstreetControl(
  record: TruckPartsCatalogRecord,
  gate: ProviderRequestGate,
  onRateLimited: WhitebradstreetRateLimitObserver,
) {
  return read(record.detailsUrl, gate, onRateLimited).pipe(
    Effect.flatMap((raw) =>
      ingestionValidation({
        try: () => parseWhitebradstreetControl(raw, record),
        catch: (cause) =>
          new WhitebradstreetProviderError({
            operation: "active donor " + record.id,
            cause,
          }),
      }),
    ),
  );
}
