import { ingestionValidation } from "./ingestion-validation";
import { sharedProviderHostSlot } from "./shared-provider-host";
import { createHash } from "node:crypto";
import { Data, Effect } from "effect";
import { readIPullUPullResponseText } from "./ipullupull-response-text";
import {
  fetchProviderResponse,
  type ProviderRequestGate,
} from "./provider-http-client";
import { parseVinplusAnalytics, parseVinplusSearch } from "./vinplus-protocol";
import { vinplusPublicQuery } from "./vinplus-public-enrichment";
import {
  parseUwrenchConfig,
  parseUwrenchInventory,
  parseUwrenchOwner,
  UWRENCH_MAX_STOCKS,
  UWRENCH_SCOPE,
  uwrenchHash,
  type UwrenchPair,
} from "./uwrench-parser";
import {
  UWRENCH_ANALYTICS_URL,
  UWRENCH_CONFIG_URL,
  UWRENCH_EMBED_URL,
  UWRENCH_INVENTORY_URL,
  UWRENCH_ORIGIN,
  UWRENCH_SEARCH_URL,
  UWRENCH_YARD,
} from "./uwrench-yard-metadata";

export class UwrenchProviderError extends Data.TaggedError(
  "UwrenchProviderError",
)<{ operation: string; cause: unknown }> {
  override get message() {
    return (
      "Tri-State U-Wrench " +
      this.operation +
      ": " +
      (this.cause instanceof Error ? this.cause.message : String(this.cause)) +
      ". No advanced checkpoint accepted; prior inventory is preserved. Inspect the native source and resume the last validated checkpoint, or restart if its scope changed."
    );
  }
}
export const validateUwrench = <A>(operation: string, run: () => A) =>
  ingestionValidation({
    try: run,
    catch: (cause) => new UwrenchProviderError({ operation, cause }),
  });
export interface UwrenchRequestBudget {
  used: number;
}
function read(
  url: string,
  mime: string,
  gate: ProviderRequestGate,
  budget: UwrenchRequestBudget,
  body?: string,
) {
  return Effect.gen(function* () {
    if (++budget.used > 24)
      return yield* new UwrenchProviderError({
        operation: "request budget",
        cause:
          "The chunk limit of 24 requests was reached before completing controls",
      });
    const response = yield* fetchProviderResponse({
      url,
      context: "Tri-State U-Wrench " + url,
      method: body === undefined ? "GET" : "POST",
      body,
      headers: body === undefined ? {} : { "Content-Type": "application/json" },
      requestGate: gate,
      redirect: "error",
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
            "Expected complete HTTP200 " +
              mime +
              " from verified endpoint; received " +
              response.status,
          );
      },
    });
    return yield* Effect.tryPromise({
      try: () =>
        readIPullUPullResponseText(
          response,
          "Tri-State U-Wrench " + url,
          AbortSignal.timeout(20_000),
        ),
      catch: (cause) => cause,
    });
  }).pipe(
    sharedProviderHostSlot(url),
    Effect.mapError(
      (cause) => new UwrenchProviderError({ operation: url, cause }),
    ),
  );
}
export function fetchUwrenchContext(
  gate: ProviderRequestGate,
  budget: UwrenchRequestBudget,
) {
  return Effect.gen(function* () {
    const owner = yield* read(UWRENCH_ORIGIN + "/", "text/html", gate, budget);
    yield* validateUwrench("native self-service owner and bridge", () =>
      parseUwrenchOwner(owner),
    );
    const inventory = yield* read(
      UWRENCH_INVENTORY_URL,
      "text/html",
      gate,
      budget,
    );
    const table = yield* validateUwrench("complete native census", () =>
      parseUwrenchInventory(inventory),
    );
    const rawConfig = yield* read(
      UWRENCH_CONFIG_URL,
      "application/json",
      gate,
      budget,
    );
    const config = yield* validateUwrench("single owned public yard", () =>
      parseUwrenchConfig(rawConfig),
    );
    const analytics = yield* read(
      UWRENCH_ANALYTICS_URL,
      "application/json",
      gate,
      budget,
    );
    const counts = yield* validateUwrench("public API own counts", () =>
      parseVinplusAnalytics(analytics, UWRENCH_MAX_STOCKS),
    );
    return {
      ...table,
      counts,
      hash: uwrenchHash({
        contract: "native-authority-whole-native-ymm-v1",
        owner: UWRENCH_YARD,
        embed: UWRENCH_EMBED_URL,
        search: {
          url: UWRENCH_SEARCH_URL,
          method: "POST",
          yardId: UWRENCH_SCOPE.yardId,
          yardName: UWRENCH_SCOPE.yardName,
          sourceSystem: UWRENCH_SCOPE.sourceSystem,
          location: { kind: "single-yard", locationId: null },
          yearMin: null,
          yearMax: null,
          language: "en",
        },
        rows: table.rows,
        pairs: table.pairs,
        config,
        counts,
      }),
    };
  });
}
export type UwrenchContext = Effect.Effect.Success<
  ReturnType<typeof fetchUwrenchContext>
>;
export function fetchUwrenchSearch(
  pair: UwrenchPair,
  gate: ProviderRequestGate,
  budget: UwrenchRequestBudget,
) {
  return Effect.gen(function* () {
    const query = yield* vinplusPublicQuery(UWRENCH_SCOPE, pair, {
      kind: "single-yard",
    });
    const raw = yield* read(
      UWRENCH_SEARCH_URL,
      "application/json",
      gate,
      budget,
      JSON.stringify(query),
    );
    return yield* validateUwrench(
      "exact native selector " + pair.make + " / " + pair.model,
      () => ({
        records: parseVinplusSearch(raw, UWRENCH_SCOPE, pair),
        rawHash: createHash("sha256").update(raw).digest("hex"),
      }),
    );
  });
}
