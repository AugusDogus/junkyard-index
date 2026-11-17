import { ingestionValidation } from "./ingestion-validation";
import { Data, Effect } from "effect";
import {
  parseDdautoPublishedApp,
  parseDdautoSnapshot,
} from "./ddauto-glide-contract";
import { parseDdautoRows, DDAUTO_QUERY_BODY } from "./ddauto-parser";
import { readIPullUPullResponseText } from "./ipullupull-response-text";
import {
  fetchProviderResponse,
  type ProviderRequestGate,
} from "./provider-http-client";
import {
  DDAUTO_APP_ID,
  DDAUTO_APP_ORIGIN,
  DDAUTO_OWNER_URL,
  DDAUTO_QUERY_URL,
  parseDdautoYard,
} from "./ddauto-yard-metadata";

export class DdautoProviderError extends Data.TaggedError(
  "DdautoProviderError",
)<{
  operation: string;
  cause: unknown;
}> {
  override get message() {
    return (
      "DD Auto " +
      this.operation +
      ": " +
      (this.cause instanceof Error ? this.cause.message : String(this.cause)) +
      ". No complete checkpoint accepted; previous inventory is preserved. Inspect the native table before retrying the start checkpoint."
    );
  }
}

function read(
  url: string,
  mime: string,
  operation: string,
  gate: ProviderRequestGate,
  body?: string,
) {
  return Effect.gen(function* () {
    const response = yield* fetchProviderResponse({
      url,
      context: "DD Auto " + operation,
      method: body === undefined ? "GET" : "POST",
      body,
      requestGate: gate,
      headers: {
        Accept: mime,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      retry: { timeoutMs: 20_000, retryLimit: 0, retryNetworkErrors: false },
      onResponse: (r) => {
        if (
          r.status !== 200 ||
          r.headers.has("content-range") ||
          (r.url && r.url !== url) ||
          r.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !==
            mime
        )
          throw new Error(
            "Expected complete HTTP200 " +
              mime +
              " from the verified endpoint, received " +
              r.status,
          );
      },
    });
    return yield* Effect.tryPromise({
      try: () =>
        readIPullUPullResponseText(
          response,
          "DD Auto " + operation,
          AbortSignal.timeout(20_000),
        ),
      catch: (cause) => cause,
    });
  }).pipe(
    Effect.mapError((cause) => new DdautoProviderError({ operation, cause })),
  );
}
function parse<A>(operation: string, run: () => A) {
  return ingestionValidation({
    try: run,
    catch: (cause) => new DdautoProviderError({ operation, cause }),
  });
}
function snapshot(gate: ProviderRequestGate) {
  return read(
    DDAUTO_APP_ORIGIN + "/api/container/playerFunctionCritical/getAppSnapshot",
    "application/json",
    "public schema",
    gate,
    JSON.stringify({ appID: DDAUTO_APP_ID }),
  ).pipe(
    Effect.flatMap((raw) =>
      parse("public schema", () => parseDdautoSnapshot(raw)),
    ),
  );
}

export function fetchDdautoCatalog(gate: ProviderRequestGate) {
  return Effect.gen(function* () {
    const owner = yield* read(
      DDAUTO_OWNER_URL,
      "text/html",
      "physical owner",
      gate,
    );
    const yard = yield* parse("physical owner", () => parseDdautoYard(owner));
    const before = yield* snapshot(gate);
    const published = yield* read(
      before.publishedUrl,
      "application/json",
      "published availability contract",
      gate,
    );
    yield* parse("published availability contract", () =>
      parseDdautoPublishedApp(published, before.publishedAt),
    );
    // Read current documents directly. Glide's native GCS baseline omits later updates.
    const raw = yield* read(
      DDAUTO_QUERY_URL,
      "application/json",
      "current complete table",
      gate,
      DDAUTO_QUERY_BODY,
    );
    const catalog = yield* parse("current complete table", () =>
      parseDdautoRows(raw, before.colorColumn),
    );
    const after = yield* snapshot(gate);
    if (before.signature !== after.signature)
      return yield* new DdautoProviderError({
        operation: "schema drift",
        cause:
          "Published app or field schema changed during the inventory read",
      });
    return { ...catalog, yard };
  });
}
