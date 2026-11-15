import { Data, Effect } from "effect";
import { readIPullUPullResponseText } from "./ipullupull-response-text";
import {
  fetchProviderResponse,
  type ProviderRequestGate,
} from "./provider-http-client";
import {
  jolietHash,
  jolietYearCounts,
  JOLIET_MAX_DISAGREEMENT_RATIO,
  jolietQuery,
  parseJolietAnalytics,
  parseJolietConfig,
  parseJolietContact,
  parseJolietInventory,
  parseJolietOwner,
  parseJolietSearch,
  type JolietPair,
} from "./joliet-parser";
import {
  JOLIET_ANALYTICS_URL,
  JOLIET_CONFIG_URL,
  JOLIET_CONTACT_URL,
  JOLIET_EMBED_URL,
  JOLIET_INVENTORY_URL,
  JOLIET_ORIGIN,
  JOLIET_SEARCH_URL,
  JOLIET_YARD,
} from "./joliet-yard-metadata";

export class JolietProviderError extends Data.TaggedError(
  "JolietProviderError",
)<{
  operation: string;
  cause: unknown;
}> {
  override get message() {
    return (
      "Joliet " +
      this.operation +
      ": " +
      (this.cause instanceof Error ? this.cause.message : String(this.cause)) +
      ". No advanced checkpoint accepted; prior inventory is preserved. Inspect the native source and retry from the last validated checkpoint."
    );
  }
}
export const validateJoliet = <A>(operation: string, run: () => A) =>
  Effect.try({
    try: run,
    catch: (cause) => new JolietProviderError({ operation, cause }),
  });

function read(
  url: string,
  mime: string,
  gate: ProviderRequestGate,
  body?: string,
) {
  return Effect.gen(function* () {
    const response = yield* fetchProviderResponse({
      url,
      context: "Joliet " + url,
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
          "Joliet " + url,
          AbortSignal.timeout(20_000),
        ),
      catch: (cause) => cause,
    });
  }).pipe(
    Effect.mapError(
      (cause) => new JolietProviderError({ operation: url, cause }),
    ),
  );
}

export function fetchJolietContext(gate: ProviderRequestGate) {
  return Effect.gen(function* () {
    const owner = yield* read(JOLIET_ORIGIN + "/", "text/html", gate);
    yield* validateJoliet("active self-service ownership", () =>
      parseJolietOwner(owner),
    );
    const contact = yield* read(JOLIET_CONTACT_URL, "text/html", gate);
    yield* validateJoliet("physical contact ownership", () =>
      parseJolietContact(contact),
    );
    const inventory = yield* read(JOLIET_INVENTORY_URL, "text/html", gate);
    const table = yield* validateJoliet("native table scope", () =>
      parseJolietInventory(inventory),
    );
    const config = yield* read(JOLIET_CONFIG_URL, "application/json", gate);
    const yard = yield* validateJoliet("native owner configuration", () =>
      parseJolietConfig(config),
    );
    const analytics = yield* read(
      JOLIET_ANALYTICS_URL,
      "application/json",
      gate,
    );
    const counts = yield* validateJoliet("native active counts", () =>
      parseJolietAnalytics(analytics),
    );
    return yield* validateJoliet(
      "official stock/year and native count reconciliation",
      () => {
        const years = new Map(
          jolietYearCounts(table.rows).years.map((row) => [
            row.year,
            row.count,
          ]),
        );
        for (const row of counts.years)
          years.set(row.year, (years.get(row.year) ?? 0) - row.count);
        // Year-count differences are a lower bound. Reconcile the exact API
        // stock union and its year counts after traversal, including API-only stocks.
        const difference = [...years.values()].reduce(
          (sum, count) => sum + Math.abs(count),
          0,
        );
        if (difference / table.rows.length > JOLIET_MAX_DISAGREEMENT_RATIO)
          throw new Error(
            "Official stock/year table and native active counts exceed the 5% disagreement limit",
          );
        return {
          ...table,
          counts,
          hash: jolietHash({
            source: "joliet",
            owner: JOLIET_YARD,
            embed: JOLIET_EMBED_URL,
            contact: JOLIET_CONTACT_URL,
            table: table.rows,
            pairs: table.pairs,
            counts,
            yard,
          }),
        };
      },
    );
  });
}
export type JolietContext = Effect.Effect.Success<
  ReturnType<typeof fetchJolietContext>
>;

export function fetchJolietSearch(pair: JolietPair, gate: ProviderRequestGate) {
  return read(
    JOLIET_SEARCH_URL,
    "application/json",
    gate,
    JSON.stringify(jolietQuery(pair)),
  ).pipe(
    Effect.flatMap((raw) =>
      validateJoliet("native query " + pair.make + " / " + pair.model, () => ({
        records: parseJolietSearch(raw, pair),
        hash: jolietHash(raw),
      })),
    ),
  );
}
