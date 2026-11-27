import { parse } from "csv-parse/sync";
import { Data, Effect, Schema } from "effect";
import {
  IPULLUPULL_MAX_RESPONSE_BYTES,
  readIPullUPullResponseText,
} from "./ipullupull-response-text";
import {
  ProviderChunkClock,
  ProviderNotReadyDeferred,
} from "./provider-chunk-clock";
import {
  fetchProviderResponse,
  type ProviderRequestGate,
  type ProviderRetryPolicy,
} from "./provider-http-client";

export const IPULLUPULL_INVENTORY_URL =
  "https://ipullupull.com/inventory-pricing/";
export const IPULLUPULL_EXPORT_URL = `${IPULLUPULL_INVENTORY_URL}?ipull_export=1&slug=inventory-pricing&type=inventory&format=csv`;
export const IPULLUPULL_MAX_CATALOG_RECORDS = 20_000;
export const IPULLUPULL_MAX_CATALOG_BYTES = IPULLUPULL_MAX_RESPONSE_BYTES;

/**
 * The host answers HTTP 429 after about 40 to 50 requests of a crawl
 * (production Nov 20 and Nov 27, 2026), and the limit can last hours. Retrying
 * the request, or rerunning the step, only sends more requests into it, so a
 * 429 is not retried here: it defers the whole atomic chunk, and the source
 * crawls again after its rate-limit cooldown. Origin 502/503/504 still retry.
 */
export const IPULLUPULL_REQUEST_RETRY = {
  retryLimit: 2,
  retryNetworkErrors: false,
  jitter: false,
  retryableStatusCodes: [502, 503, 504],
} as const satisfies Partial<ProviderRetryPolicy>;

/** The chunk deferral for a rate-limited `response`, or null for any other
 * status. */
export function ipullUPullRateLimit(response: Response, context: string) {
  if (response.status !== 429) return null;
  const retryAfter = response.headers.get("Retry-After");
  return new ProviderNotReadyDeferred({
    provider: "iPull-uPull",
    detail: `${context} answered HTTP 429 Too Many Requests${retryAfter === null ? "" : ` (Retry-After ${retryAfter}${/^\d+$/.test(retryAfter) ? " s" : ""})`}. The crawl stopped at this refusal without retrying it.`,
  });
}

/** `response` unchanged, or its rate-limit deferral. */
export function refuseIPullUPullRateLimit(
  response: Response,
  context: string,
): Effect.Effect<Response, ProviderNotReadyDeferred> {
  const rateLimit = ipullUPullRateLimit(response, context);
  return rateLimit ? Effect.fail(rateLimit) : Effect.succeed(response);
}

export class IPullUPullProviderError extends Data.TaggedError(
  "IPullUPullProviderError",
)<{
  cause: unknown;
}> {
  override get message() {
    return `iPull-uPull catalog: ${this.cause instanceof Error ? this.cause.message : String(this.cause)}`;
  }
}

export const IPullUPullRecordSchema = Schema.Struct({
  "Stock Number": Schema.String,
  Status: Schema.String,
  "Yard Date": Schema.String,
  "Yard City": Schema.String,
  Year: Schema.String,
  Make: Schema.String,
  Model: Schema.String,
  "Vehicle Row": Schema.String,
  Color: Schema.String,
  Vin: Schema.String,
  Transmission: Schema.String,
  Engine: Schema.String,
});
export type IPullUPullRecord = Schema.Schema.Type<
  typeof IPullUPullRecordSchema
>;

export function parseIPullUPullCsv(text: string) {
  return Effect.try({
    try: () => {
      // The exporter terminates every record. A missing final newline can mean
      // a cut-off last field even when that prefix is otherwise valid CSV.
      if (
        !text.endsWith("\n") ||
        Buffer.byteLength(text) > IPULLUPULL_MAX_CATALOG_BYTES
      )
        throw new Error(
          "CSV is unterminated or exceeds the 4 MiB checkpoint bound; inspect the export before retrying.",
        );
      const records: unknown = parse(text, {
        bom: true,
        max_record_size: 64 * 1024,
        columns: (headers: string[]) => {
          for (const key of Object.keys(IPullUPullRecordSchema.fields)) {
            if (headers.filter((header) => header === key).length !== 1)
              throw new Error(
                `CSV requires exactly one ${key} column; inspect the export schema.`,
              );
          }
          // Extra part-description columns can legitimately repeat. Only the
          // consumed vehicle fields above must have unique headings.
          return headers;
        },
      });
      return Schema.decodeUnknownSync(
        Schema.Array(IPullUPullRecordSchema).pipe(
          Schema.minItems(1),
          Schema.maxItems(IPULLUPULL_MAX_CATALOG_RECORDS),
        ),
      )(records);
    },
    catch: (cause) => new IPullUPullProviderError({ cause }),
  });
}

/** One unfiltered export, measured at 733 KB / 4,275 rows on 2026-09-15. */
export function fetchIPullUPullCatalog(requestGate?: ProviderRequestGate) {
  return fetchProviderResponse({
    url: IPULLUPULL_EXPORT_URL,
    context: "iPull-uPull CSV export",
    headers: { Accept: "text/csv" },
    requestGate,
    retry: IPULLUPULL_REQUEST_RETRY,
  }).pipe(
    Effect.flatMap((response) =>
      refuseIPullUPullRateLimit(response, "iPull-uPull CSV export"),
    ),
    Effect.flatMap((response) =>
      Effect.tryPromise({
        try: async (signal) => {
          if (
            response.status !== 200 ||
            response.headers.has("content-range") ||
            response.headers.has("link")
          )
            throw new Error(
              `CSV returned HTTP ${response.status} or partial/paginated headers; no catalog was accepted.`,
            );
          if (
            !response.headers
              .get("content-type")
              ?.toLowerCase()
              .startsWith("text/csv")
          )
            throw new Error(
              "Expected text/csv; inspect the endpoint for an error page or format change.",
            );
          return readIPullUPullResponseText(response, "CSV", signal);
        },
        catch: (cause) => new IPullUPullProviderError({ cause }),
      }),
    ),
    Effect.mapError((cause) =>
      cause instanceof IPullUPullProviderError ||
      ProviderChunkClock.isDeferral(cause)
        ? cause
        : new IPullUPullProviderError({ cause }),
    ),
    Effect.flatMap(parseIPullUPullCsv),
  );
}
