import { parse } from "csv-parse/sync";
import { Data, Effect, Schema } from "effect";
import {
  IPULLUPULL_MAX_RESPONSE_BYTES,
  readIPullUPullResponseText,
} from "./ipullupull-response-text";
import {
  fetchProviderResponse,
  type ProviderRequestGate,
} from "./provider-http-client";

export const IPULLUPULL_INVENTORY_URL =
  "https://ipullupull.com/inventory-pricing/";
export const IPULLUPULL_EXPORT_URL = `${IPULLUPULL_INVENTORY_URL}?ipull_export=1&slug=inventory-pricing&type=inventory&format=csv`;
export const IPULLUPULL_MAX_CATALOG_RECORDS = 20_000;
export const IPULLUPULL_MAX_CATALOG_BYTES = IPULLUPULL_MAX_RESPONSE_BYTES;

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
    retry: { retryLimit: 2, retryNetworkErrors: false, jitter: false },
  }).pipe(
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
      cause instanceof IPullUPullProviderError
        ? cause
        : new IPullUPullProviderError({ cause }),
    ),
    Effect.flatMap(parseIPullUPullCsv),
  );
}
