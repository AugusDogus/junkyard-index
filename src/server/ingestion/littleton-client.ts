import {
  ingestionValidation,
  transientRejection,
  validationRejectionKind,
} from "./ingestion-validation";
import {
  ProviderChunkClock,
  ProviderNotReadyDeferred,
} from "./provider-chunk-clock";
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
/** The website host sits behind SiteGround's anti-bot layer, which answers
 * some requests with a 202 "Robot Challenge Screen" for a while instead of
 * the page. Retrying within seconds sees the same challenge. */
const SITEGROUND_CHALLENGE_STATUS = 202;
const siteGroundChallenge = (response: Response, text: string) =>
  response.headers.get("sg-captcha") === "challenge" ||
  /\/\.well-known\/(?:sg)?captcha\//.test(text);
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
        // Read the body to tell a challenge from any other 202.
        if (response.status === SITEGROUND_CHALLENGE_STATUS) return;
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
    const text = yield* Effect.tryPromise({
      try: () =>
        readIPullUPullResponseText(
          response,
          "Littleton " + url,
          AbortSignal.timeout(20_000),
        ),
      catch: (cause) => cause,
    });
    if (response.status !== SITEGROUND_CHALLENGE_STATUS) return text;
    if (siteGroundChallenge(response, text))
      return yield* new ProviderNotReadyDeferred({
        provider: "Littleton",
        detail:
          url +
          " answered with SiteGround's bot challenge (HTTP 202) instead of the page.",
      });
    return yield* Effect.fail(
      new Error(
        "Expected complete HTTP 200 " +
          mime +
          " from the verified endpoint, received 202 without SiteGround's bot challenge",
      ),
    );
  }).pipe(
    sharedProviderHostSlot(url),
    Effect.mapError((cause) =>
      ProviderChunkClock.isDeferral(cause)
        ? cause
        : new LittletonProviderError({ operation: url, cause }),
    ),
  );
}
/**
 * What a context read does when the website table and the VinPlus counts
 * disagree. The yard publishes them separately, and the counts can trail the
 * table by hours after the nightly publish.
 *
 * - wait: no snapshot is bound yet, so the chunk defers until both agree.
 * - drift: the crawl is bound to an earlier agreeing snapshot that no longer
 *   holds, so it is rejected as transient drift and a fresh crawl retries.
 */
export type LittletonUnsettledViews = "wait" | "drift";
const contextError = (cause: unknown) =>
  new LittletonProviderError({
    operation: "physical ownership, native scope and current counts",
    cause,
  });
export function fetchLittletonContext(
  gate: ProviderRequestGate,
  unsettled: LittletonUnsettledViews,
) {
  return Effect.gen(function* () {
    const owner = yield* read(LITTLETON_ORIGIN + "/", "text/html", gate);
    const inventory = yield* read(LITTLETON_INVENTORY_URL, "text/html", gate);
    const config = yield* read(LITTLETON_CONFIG_URL, "application/json", gate);
    const analytics = yield* read(
      LITTLETON_ANALYTICS_URL,
      "application/json",
      gate,
    );
    const reconciliation = yield* ingestionValidation({
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
        const context = {
          ...table,
          counts,
          hash: littletonHash({
            table: table.rows,
            pairs: table.pairs,
            counts,
            yard,
          }),
        };
        if (
          counts.count === table.rows.length &&
          JSON.stringify(counts.years) === JSON.stringify(tableYears)
        )
          return { context, unreconciled: null };
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
        return {
          context,
          unreconciled:
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
        };
      },
      catch: contextError,
    });
    if (reconciliation.unreconciled === null) return reconciliation.context;
    const unreconciled = reconciliation.unreconciled;
    // The exact match stays the guard: a table that lost whole make/model
    // pairs is never queried for them, so only the counts can catch it.
    if (unsettled === "wait")
      return yield* new ProviderNotReadyDeferred({
        provider: "Littleton",
        detail:
          unreconciled +
          ". The yard publishes its website table and VinPlus counts separately, and the counts can trail the nightly table publish by hours, so the crawl waits for them to agree before it starts.",
      });
    return yield* ingestionValidation({
      try: () => {
        throw littletonDrift(unreconciled);
      },
      catch: contextError,
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
