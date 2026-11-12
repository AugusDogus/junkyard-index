import { Data, Effect } from "effect";
import {
  fetchProviderResponse,
  type ProviderRequestGate,
} from "./provider-http-client";
import { readIPullUPullResponseText } from "./ipullupull-response-text";
import { pipesQuery, type PipesPair } from "./pipes-parser";
import {
  PIPES_CONFIG_URL,
  PIPES_DIRECTIONS_URL,
  PIPES_INVENTORY_URL,
  PIPES_ORIGIN,
  PIPES_SEARCH_URL,
} from "./pipes-yard-metadata";

export class PipesProviderError extends Data.TaggedError("PipesProviderError")<{
  operation: string;
  cause: unknown;
}> {
  override get message() {
    return (
      "Pipes " +
      this.operation +
      ": " +
      (this.cause instanceof Error ? this.cause.message : String(this.cause)) +
      ". No advanced checkpoint accepted; prior inventory is preserved. Inspect the source and retry from the last validated checkpoint."
    );
  }
}
export type PipesControl =
  | { kind: "context"; index: number }
  | { kind: "native"; make: string }
  | { kind: "query"; pair: PipesPair };

export function fetchPipesControl(
  control: PipesControl,
  gate: ProviderRequestGate,
) {
  return Effect.gen(function* () {
    let url: string, mime: string, body: string | undefined;
    let contentType: string | undefined;
    if (control.kind === "query") {
      url = PIPES_SEARCH_URL;
      mime = "application/json";
      contentType = "application/json";
      body = JSON.stringify(yield* pipesQuery(control.pair));
    } else if (control.kind === "native" || control.index === 1) {
      url = PIPES_INVENTORY_URL;
      mime = "text/html";
      contentType = "application/x-www-form-urlencoded";
      body = new URLSearchParams({
        VehicleMake: control.kind === "native" ? control.make : "",
        VehicleModel: "",
      }).toString();
    } else if (control.index === 0) {
      url = PIPES_ORIGIN + "/";
      mime = "text/html";
    } else if (control.index === 2) {
      url = PIPES_DIRECTIONS_URL;
      mime = "text/html";
    } else if (control.index === 3) {
      url = PIPES_CONFIG_URL;
      mime = "application/json";
    } else
      return yield* new PipesProviderError({
        operation: "control directory",
        cause: "Context index must be one of the four approved controls",
      });
    // The gate covers both fetch and body consumption. The same deadline starts
    // after admission and bounds their combined duration, rather than each half.
    return yield* gate(
      Effect.suspend(() => {
        const deadline = AbortSignal.timeout(20_000);
        return Effect.gen(function* () {
          const response = yield* fetchProviderResponse({
            url,
            context: "Pipes " + url,
            method: body === undefined ? "GET" : "POST",
            redirect: "manual",
            body,
            headers: contentType ? { "Content-Type": contentType } : {},
            retry: {
              timeoutMs: 20_000,
              retryLimit: 0,
              retryNetworkErrors: false,
            },
            onResponse: (response) => {
              if (
                response.status !== 200 ||
                response.redirected ||
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
                    " from " +
                    url +
                    ", received " +
                    response.status,
                );
            },
          });
          return yield* Effect.tryPromise({
            try: () =>
              readIPullUPullResponseText(response, "Pipes " + url, deadline),
            catch: (cause) => cause,
          });
        }).pipe(
          Effect.timeoutFail({
            duration: "20 seconds",
            onTimeout: () =>
              new Error(
                "Combined request and complete-body deadline exceeded 20 seconds",
              ),
          }),
        );
      }),
    );
  }).pipe(
    Effect.mapError(
      (cause) =>
        new PipesProviderError({ operation: control.kind + " control", cause }),
    ),
  );
}
