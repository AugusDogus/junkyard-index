import {
  ingestionValidation,
  transientRejection,
  validationRejectionKind,
} from "./ingestion-validation";
import { sharedProviderHostSlot } from "./shared-provider-host";
import { Data, Effect } from "effect";
import { readIPullUPullResponseText } from "./ipullupull-response-text";
import {
  fetchProviderResponse,
  type ProviderRequestGate,
} from "./provider-http-client";
import {
  littletonHash,
  littletonQuery,
  parseLittletonAnalytics,
  parseLittletonConfig,
  parseLittletonInventory,
  parseLittletonOwner,
  parseLittletonSearch,
  type LittletonPair,
} from "./littleton-parser";
import {
  LITTLETON_ANALYTICS_URL,
  LITTLETON_CONFIG_URL,
  LITTLETON_INVENTORY_URL,
  LITTLETON_ORIGIN,
  LITTLETON_SEARCH_URL,
} from "./littleton-yard-metadata";

export class LittletonProviderError extends Data.TaggedError(
  "LittletonProviderError",
)<{ operation: string; cause: unknown }> {
  override get message() {
    return (
      "Littleton " +
      this.operation +
      ": " +
      (this.cause instanceof Error ? this.cause.message : String(this.cause)) +
      ". No advanced checkpoint accepted; prior inventory is preserved." +
      // Drift already says the source retries on its own.
      (validationRejectionKind(this.cause) === "transient"
        ? ""
        : " Inspect the native source and retry from the last validated checkpoint.")
    );
  }
}
/** The yard changed while it was read. A fresh crawl after the publish
 * settles can pass, so the source retries after the usual delay within its
 * daily attempts instead of ending its day. */
export function littletonDrift(message: string): Error {
  return transientRejection(
    new Error(
      message +
        "; the yard most likely published a change while it was read, so the source retries after the usual delay within its daily attempts",
    ),
  );
}
function read(
  url: string,
  mime: string,
  gate: ProviderRequestGate,
  body?: string,
) {
  return Effect.gen(function* () {
    const response = yield* fetchProviderResponse({
      url,
      context: "Littleton " + url,
      method: body === undefined ? "GET" : "POST",
      body,
      headers: {
        // This host drops connections for the shared Chrome User-Agent.
        "User-Agent":
          "Mozilla/5.0 (X11; Linux x86_64; rv:157.0) Gecko/20100101 Firefox/157.0",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      requestGate: gate,
      retry: { timeoutMs: 20_000, retryLimit: 0, retryNetworkErrors: false },
      onResponse: (response) => {
        if (
          response.status !== 200 ||
          response.headers.has("content-range") ||
          (response.url && response.url !== url) ||
          response.headers
            .get("content-type")
            ?.split(";")[0]
            ?.trim()
            .toLowerCase() !== mime
        )
          throw new Error(
            "Expected complete HTTP 200 " +
              mime +
              " from the verified endpoint, received " +
              response.status,
          );
      },
    });
    return yield* Effect.tryPromise({
      try: () =>
        readIPullUPullResponseText(
          response,
          "Littleton " + url,
          AbortSignal.timeout(20_000),
        ),
      catch: (cause) => cause,
    });
  }).pipe(
    sharedProviderHostSlot(url),
    Effect.mapError(
      (cause) => new LittletonProviderError({ operation: url, cause }),
    ),
  );
}
export function fetchLittletonContext(gate: ProviderRequestGate) {
  return Effect.gen(function* () {
    const owner = yield* read(LITTLETON_ORIGIN + "/", "text/html", gate);
    const inventory = yield* read(LITTLETON_INVENTORY_URL, "text/html", gate);
    const config = yield* read(LITTLETON_CONFIG_URL, "application/json", gate);
    const analytics = yield* read(
      LITTLETON_ANALYTICS_URL,
      "application/json",
      gate,
    );
    return yield* ingestionValidation({
      try: () => {
        parseLittletonOwner(owner);
        const table = parseLittletonInventory(inventory);
        const yard = parseLittletonConfig(config);
        const counts = parseLittletonAnalytics(analytics);
        const years = new Map<number, number>();
        for (const row of table.rows)
          years.set(row.year, (years.get(row.year) ?? 0) + 1);
        const tableYears = [...years]
          .map(([year, count]) => ({ year, count }))
          .sort((a, b) => a.year - b.year);
        // The website table and the VinPlus counts publish separately, so a
        // read between the two sees one side updated. That passes once the
        // publish settles.
        if (
          counts.count !== table.rows.length ||
          JSON.stringify(counts.years) !== JSON.stringify(tableYears)
        ) {
          // Both sides are sorted unique positive counts, so a mismatch
          // always differs in at least one year.
          const counted = new Map(counts.years.map((r) => [r.year, r.count]));
          const differing = [...new Set([...years.keys(), ...counted.keys()])]
            .sort((a, b) => a - b)
            .filter((year) => years.get(year) !== counted.get(year))
            .map(
              (year) =>
                "year " +
                year +
                ": table " +
                (years.get(year) ?? 0) +
                ", counts " +
                (counted.get(year) ?? 0),
            );
          throw littletonDrift(
            "Official stock/year table (" +
              table.rows.length +
              (table.rows.length === 1 ? " stock" : " stocks") +
              ") does not reconcile with native active inventory counts (" +
              counts.count +
              (counts.count === 1 ? " stock" : " stocks") +
              "); " +
              differing.slice(0, 5).join("; ") +
              (differing.length > 5
                ? "; and " + (differing.length - 5) + " more years"
                : ""),
          );
        }
        return {
          ...table,
          counts,
          hash: littletonHash({
            table: table.rows,
            pairs: table.pairs,
            counts,
            yard,
          }),
        };
      },
      catch: (cause) =>
        new LittletonProviderError({
          operation: "physical ownership, native scope and current counts",
          cause,
        }),
    });
  });
}
export type LittletonContext = Effect.Effect.Success<
  ReturnType<typeof fetchLittletonContext>
>;
export function fetchLittletonSearch(
  pair: LittletonPair,
  gate: ProviderRequestGate,
) {
  return read(
    LITTLETON_SEARCH_URL,
    "application/json",
    gate,
    JSON.stringify(littletonQuery(pair)),
  ).pipe(
    Effect.flatMap((raw) =>
      ingestionValidation({
        try: () => ({
          records: parseLittletonSearch(raw, pair),
          hash: littletonHash(raw),
        }),
        catch: (cause) =>
          new LittletonProviderError({
            operation: "native query " + pair.make + " / " + pair.model,
            cause,
          }),
      }),
    ),
  );
}
