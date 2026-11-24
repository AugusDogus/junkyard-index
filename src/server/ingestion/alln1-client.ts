import { randomBytes } from "node:crypto";
import { ingestionValidation } from "./ingestion-validation";
import { sharedProviderHostSlot } from "./shared-provider-host";
import { Data, Effect } from "effect";
import {
  fetchProviderResponse,
  type ProviderRequestGate,
} from "./provider-http-client";
import { readIPullUPullResponseText } from "./ipullupull-response-text";
import {
  parseAlln1Owner,
  parseAlln1Page,
  parseAlln1Search,
} from "./alln1-parser";
import {
  ALLN1_TENANT,
  type Alln1Tenant,
  alln1CacheBustUrl,
  alln1PageNumber,
  alln1SearchDate,
  alln1SearchUrl,
} from "./alln1-yard-metadata";

export class Alln1ProviderError extends Data.TaggedError("Alln1ProviderError")<{
  operation: string;
  cause: unknown;
}> {
  override get message() {
    return (
      "All-N-1 " +
      this.operation +
      ": " +
      (this.cause instanceof Error ? this.cause.message : String(this.cause)) +
      ". No advanced checkpoint accepted; previous inventory is preserved. Inspect native owner, scope and pagination before retrying from the last validated checkpoint."
    );
  }
}
/**
 * One budget for the headers and body of a read together. Uncached origin
 * pages took 18 to 26 seconds on November 19, 2026, and a whole read stays
 * well inside a one-request URG host turn (`requestMs` 110 s).
 */
const ALLN1_REQUEST_TIMEOUT_MS = 60_000;
/** Cloudflare statuses that serve a stored copy instead of the origin. */
const CLOUDFLARE_CACHED = /^(hit|stale|updating|revalidated)$/i;
/**
 * Fails closed on any cached response. A cache-busted request must reach the
 * origin; a Varnish or Cloudflare HIT or a nonzero (or unreadable) Age means
 * the bypass stopped working and the page may belong to an older snapshot
 * than its neighbors.
 */
function assertUncached(response: Response, url: string): void {
  const cache = response.headers.get("x-cache");
  const edge = response.headers.get("cf-cache-status");
  const age = response.headers.get("age");
  if (
    (cache !== null && /hit/i.test(cache)) ||
    (edge !== null && CLOUDFLARE_CACHED.test(edge.trim())) ||
    (age !== null && age !== "0")
  )
    throw new Error(
      url +
        " was served from a cache (x-cache " +
        (cache ?? "absent") +
        ", cf-cache-status " +
        (edge ?? "absent") +
        ", age " +
        (age ?? "absent") +
        ") despite its unique cb cache-busting nonce, so the page may belong to an older snapshot. Nothing from this crawl was accepted and previous inventory is preserved. Re-verify that a unique cb parameter still bypasses the site cache before retrying",
    );
}
/**
 * Each way `response` is not the complete, unredirected HTTP 200 text/html
 * page at `requestUrl`, worded to follow "but". Empty when it is that page.
 * A non-200 status carries its Location, since redirects are not followed.
 * A mocked Response has no URL, so an empty URL is not a redirect.
 */
function endpointFailures(response: Response, requestUrl: string): string[] {
  const failures: string[] = [];
  if (response.status !== 200) {
    const location = response.headers.get("location");
    failures.push(
      "its status was HTTP " +
        response.status +
        (location === null ? "" : " with Location " + location),
    );
  }
  if (response.redirected || (response.url && response.url !== requestUrl))
    failures.push("it was redirected to " + (response.url || "(unknown URL)"));
  const mediaType = response.headers
    .get("content-type")
    ?.split(";")[0]
    ?.trim()
    .toLowerCase();
  if (mediaType !== "text/html")
    failures.push("its content type was " + (mediaType || "absent"));
  const range = response.headers.get("content-range");
  if (range !== null)
    failures.push("it was partial (Content-Range " + range + ")");
  return failures;
}
/** A fresh cache-busting nonce for one inventory read. */
const freshNonce = () => randomBytes(8).toString("hex");
/**
 * Reads `url`. With a `nonce` the request carries it as `cb` and must miss
 * every cache. Without one it is read as published and may be cached.
 */
function read(url: string, gate: ProviderRequestGate, nonce: string | null) {
  return Effect.gen(function* () {
    const requestUrl = nonce === null ? url : alln1CacheBustUrl(url, nonce);
    // Started with the request, so the body gets only what headers left.
    const deadline = AbortSignal.timeout(ALLN1_REQUEST_TIMEOUT_MS);
    const response = yield* fetchProviderResponse({
      url: requestUrl,
      context: "All-N-1 " + requestUrl,
      requestGate: gate,
      // A redirect is never followed, so its status and Location reach the
      // failure message instead of the page it leads to.
      redirect: "manual",
      retry: {
        timeoutMs: ALLN1_REQUEST_TIMEOUT_MS,
        retryLimit: 0,
        retryNetworkErrors: false,
      },
      onResponse: (response) => {
        const failures = endpointFailures(response, requestUrl);
        if (failures.length > 0)
          throw new Error(
            "Expected complete unredirected HTTP 200 text/html from the verified endpoint, but " +
              failures.join(", and "),
          );
        if (nonce !== null) assertUncached(response, requestUrl);
      },
    });
    const html = yield* Effect.tryPromise({
      try: () =>
        readIPullUPullResponseText(response, "All-N-1 " + requestUrl, deadline),
      catch: (cause) => cause,
    });
    return html;
  }).pipe(
    sharedProviderHostSlot(url),
    Effect.mapError(
      (cause) => new Alln1ProviderError({ operation: url, cause }),
    ),
  );
}
/**
 * The owner page proves only the yard's physical identity text, not an
 * inventory snapshot, so it is read as published and may be cached. An
 * uncached root took 19.3 s on November 19, 2026.
 */
export const fetchAlln1Owner = (
  gate: ProviderRequestGate,
  tenant: Alln1Tenant = ALLN1_TENANT,
) =>
  read(tenant.origin + "/", gate, null).pipe(
    Effect.flatMap((html) =>
      ingestionValidation({
        try: () => parseAlln1Owner(html, tenant),
        catch: (cause) =>
          new Alln1ProviderError({ operation: "physical ownership", cause }),
      }),
    ),
  );
export function fetchAlln1Page(
  url: string,
  gate: ProviderRequestGate,
  tenant: Alln1Tenant = ALLN1_TENANT,
) {
  return Effect.gen(function* () {
    const page = alln1PageNumber(url, tenant);
    if (page === null)
      return yield* new Alln1ProviderError({
        operation: "page destination",
        cause: "URL is not a verified unfiltered native inventory continuation",
      });
    const nonce = freshNonce();
    const html = yield* read(url, gate, nonce);
    return yield* ingestionValidation({
      try: () => parseAlln1Page(html, page, tenant, nonce),
      catch: (cause) =>
        new Alln1ProviderError({
          operation: "native inventory page " + page,
          cause,
        }),
    });
  });
}
/** The cache-busted native search listing every donor set on `date`. */
export function fetchAlln1Search(
  date: string,
  gate: ProviderRequestGate,
  tenant: Alln1Tenant = ALLN1_TENANT,
) {
  return Effect.gen(function* () {
    const url = alln1SearchUrl(date, tenant);
    const nonce = freshNonce();
    if (alln1SearchDate(alln1CacheBustUrl(url, nonce), tenant, nonce) !== date)
      return yield* new Alln1ProviderError({
        operation: "Set Date search destination",
        cause:
          "Only k=1, view=table, cb and one ISO Set Date search may be requested, not " +
          url,
      });
    const html = yield* read(url, gate, nonce);
    return yield* ingestionValidation({
      try: () => parseAlln1Search(html, date, tenant, nonce),
      catch: (cause) =>
        new Alln1ProviderError({
          operation: "Set Date search " + date,
          cause,
        }),
    });
  });
}
