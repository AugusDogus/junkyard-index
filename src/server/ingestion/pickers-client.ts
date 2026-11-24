import {
  ingestionValidation,
  validationRejectionKind,
} from "./ingestion-validation";
import { sharedProviderHostSlot } from "./shared-provider-host";
import { Data, Effect } from "effect";
import { readIPullUPullResponseText } from "./ipullupull-response-text";
import {
  fetchProviderResponse,
  type ProviderRequestGate,
} from "./provider-http-client";
import { vinplusPublicQuery } from "./vinplus-public-enrichment";
import {
  pickersScope,
  parsePickersApp,
  parsePickersConfig,
  parsePickersInventory,
  parsePickersOwner,
  parsePickersSearch,
  pickersBodyHash,
  pickersSearchComparisonHash,
  type PickersPair,
} from "./pickers-parser";
import {
  PICKERS_DEFAULT_SITE,
  PICKERS_SEARCH_URL,
  type PickersSite,
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
      ". No advanced checkpoint accepted; prior inventory is preserved." +
      // Drift already says the source retries on its own.
      (validationRejectionKind(this.cause) === "transient"
        ? ""
        : " Inspect the native source and retry from the last validated checkpoint.")
    );
  }
}
export const pickersValidated = <A>(operation: string, run: () => A) =>
  ingestionValidation({
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
  comparisonHash?: (raw: string) => string,
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
      ...(comparisonHash ? { comparisonHash: comparisonHash(raw) } : {}),
      bytes: Buffer.byteLength(raw),
    }));
  }).pipe(
    sharedProviderHostSlot(url),
    Effect.mapError((cause) =>
      cause instanceof PickersProviderError
        ? cause
        : new PickersProviderError({ operation: url, cause }),
    ),
    gate,
  );
}
export const fetchPickersOwner = (
  gate: ProviderRequestGate,
  site: PickersSite = PICKERS_DEFAULT_SITE,
) =>
  read(
    site.origin + "/",
    "text/html",
    (raw) => parsePickersOwner(raw, site),
    gate,
  );
export const fetchPickersApp = (
  gate: ProviderRequestGate,
  site: PickersSite = PICKERS_DEFAULT_SITE,
) => read(site.appUrl, "text/html", (raw) => parsePickersApp(raw, site), gate);
export const fetchPickersConfig = (
  gate: ProviderRequestGate,
  site: PickersSite = PICKERS_DEFAULT_SITE,
) =>
  read(
    site.configUrl,
    "application/json",
    (raw) => parsePickersConfig(raw, site),
    gate,
  );
export const fetchPickersInventory = (
  gate: ProviderRequestGate,
  make?: string,
  site: PickersSite = PICKERS_DEFAULT_SITE,
) =>
  read(
    site.origin + "/Home/Inventory",
    "text/html",
    (raw) => parsePickersInventory(raw, site),
    gate,
    make === undefined
      ? undefined
      : new URLSearchParams({ VehicleMake: make, VehicleModel: "" }).toString(),
    "application/x-www-form-urlencoded",
  );
export function fetchPickersSearch(
  pair: PickersPair,
  gate: ProviderRequestGate,
  site: PickersSite = PICKERS_DEFAULT_SITE,
) {
  return vinplusPublicQuery(pickersScope(site), pair, {
    kind: "per-location",
    id: site.locationId,
  }).pipe(
    Effect.flatMap((payload) =>
      read(
        PICKERS_SEARCH_URL,
        "application/json",
        (raw) => parsePickersSearch(raw, pair, site),
        gate,
        JSON.stringify(payload),
        "application/json",
        pickersSearchComparisonHash,
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
