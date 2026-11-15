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
      ". No advanced checkpoint accepted; prior inventory is preserved. Inspect the native source and retry from the last validated checkpoint."
    );
  }
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
    return yield* Effect.try({
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
        if (
          counts.count !== table.rows.length ||
          JSON.stringify(counts.years) !== JSON.stringify(tableYears)
        )
          throw new Error(
            "Official stock/year table does not reconcile with native active inventory counts",
          );
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
      Effect.try({
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
