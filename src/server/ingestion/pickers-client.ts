import { Data, Effect } from "effect";
import { readIPullUPullResponseText } from "./ipullupull-response-text";
import {
  fetchProviderResponse,
  type ProviderRequestGate,
} from "./provider-http-client";
import { vinplusPublicQuery } from "./vinplus-public-enrichment";
import {
  PICKERS_SCOPE,
  parsePickersApp,
  parsePickersConfig,
  parsePickersInventory,
  parsePickersOwner,
  parsePickersSearch,
  pickersBodyHash,
  type PickersPair,
} from "./pickers-parser";
import {
  PICKERS_APP_URL,
  PICKERS_CONFIG_URL,
  PICKERS_INVENTORY_URL,
  PICKERS_LOCATION_ID,
  PICKERS_ORIGIN,
  PICKERS_SEARCH_URL,
} from "./pickers-yard-metadata";

export class PickersProviderError extends Data.TaggedError(
  "PickersProviderError",
)<{
  operation: string;
  cause: unknown;
}> {
  override get message() {
    return (
      "Pickers " +
      this.operation +
      ": " +
      (this.cause instanceof Error ? this.cause.message : String(this.cause)) +
      ". No advanced checkpoint accepted; prior inventory is preserved. Inspect the native source and retry from the last validated checkpoint."
    );
  }
}
export const pickersValidated = <A>(operation: string, run: () => A) =>
  Effect.try({
    try: run,
    catch: (cause) => new PickersProviderError({ operation, cause }),
  });

/** The deadline starts before headers and is reused while reading the body. */
function read<A>(
  url: string,
  mime: string,
  parse: (raw: string) => A,
  gate: ProviderRequestGate,
  body?: string,
  contentType = "application/json",
) {
  return Effect.gen(function* () {
    const signal = AbortSignal.timeout(20_000);
    const response = yield* fetchProviderResponse({
      url,
      context: "Pickers " + url,
      method: body === undefined ? "GET" : "POST",
      body,
      redirect: "manual",
      headers: body === undefined ? {} : { "Content-Type": contentType },
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
              " at verified endpoint; received " +
              response.status,
          );
      },
    });
    const raw = yield* Effect.tryPromise({
      try: () => readIPullUPullResponseText(response, "Pickers " + url, signal),
      catch: (cause) => cause,
    });
    return yield* pickersValidated("response validation at " + url, () => ({
      value: parse(raw),
      bodyHash: pickersBodyHash(raw),
      bytes: Buffer.byteLength(raw),
    }));
  }).pipe(
    Effect.mapError((cause) =>
      cause instanceof PickersProviderError
        ? cause
        : new PickersProviderError({ operation: url, cause }),
    ),
    gate,
  );
}
export const fetchPickersOwner = (gate: ProviderRequestGate) =>
  read(PICKERS_ORIGIN + "/", "text/html", parsePickersOwner, gate);
export const fetchPickersApp = (gate: ProviderRequestGate) =>
  read(PICKERS_APP_URL, "text/html", parsePickersApp, gate);
export const fetchPickersConfig = (gate: ProviderRequestGate) =>
  read(PICKERS_CONFIG_URL, "application/json", parsePickersConfig, gate);
export const fetchPickersInventory = (
  gate: ProviderRequestGate,
  make?: string,
) =>
  read(
    PICKERS_INVENTORY_URL,
    "text/html",
    parsePickersInventory,
    gate,
    make === undefined
      ? undefined
      : new URLSearchParams({ VehicleMake: make, VehicleModel: "" }).toString(),
    "application/x-www-form-urlencoded",
  );
export function fetchPickersSearch(
  pair: PickersPair,
  gate: ProviderRequestGate,
) {
  return vinplusPublicQuery(PICKERS_SCOPE, pair, {
    kind: "per-location",
    id: PICKERS_LOCATION_ID,
  }).pipe(
    Effect.flatMap((payload) =>
      read(
        PICKERS_SEARCH_URL,
        "application/json",
        (raw) => parsePickersSearch(raw, pair),
        gate,
        JSON.stringify(payload),
      ),
    ),
    Effect.mapError(
      (cause) =>
        new PickersProviderError({
          operation: "resolved-location query",
          cause,
        }),
    ),
  );
}
