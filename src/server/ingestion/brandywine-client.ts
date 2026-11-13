import { Clock, Data, Effect } from "effect";
import {
  fetchProviderResponse,
  type ProviderRequestGate,
} from "./provider-http-client";
import { readIPullUPullResponseText } from "./ipullupull-response-text";
import {
  BRANDYWINE_MAX_RESPONSE_BYTES,
  brandywineBody,
  brandywineRedirect,
  brandywineRoute,
  type BrandywineReceipt,
} from "./brandywine-html";

export class BrandywineProviderError extends Data.TaggedError(
  "BrandywineProviderError",
)<{ operation: string; cause: unknown }> {
  override get message() {
    const detail =
      this.cause instanceof Error ? this.cause.message : String(this.cause);
    return `Brandywine ${this.operation}: ${detail}. Prior inventory is preserved and no advanced checkpoint is accepted. Retain the last validated checkpoint and inspect the native response before resuming.`;
  }
}

export interface BrandywineFetchedPage {
  html: string;
  receipt: BrandywineReceipt;
}

/** Anonymous GET, no cookies, no retries, at most the observed exact 301 hop. */
export function fetchBrandywinePage(url: string, gate: ProviderRequestGate) {
  if (!brandywineRoute(url))
    return Effect.fail(
      new BrandywineProviderError({
        operation: "destination",
        cause: "URL is outside the exact published native graph",
      }),
    );
  return Effect.suspend(() => {
    const deadline = AbortSignal.timeout(25_000);
    return Effect.gen(function* () {
      const stopAt = (yield* Clock.currentTimeMillis) + 25_000;
      const wires: BrandywineReceipt["wires"] = [];
      let current = url,
        totalBytes = 0;
      for (let step = 0; step < 2; step++) {
        const result = yield* gate(
          Effect.gen(function* () {
            const now = yield* Clock.currentTimeMillis;
            const response = yield* fetchProviderResponse({
              url: current,
              context: "Brandywine " + current,
              redirect: "manual",
              headers: {
                "User-Agent": "JunkyardIndex source qualification",
                Accept: "text/html",
              },
              retry: {
                timeoutMs: Math.max(1, stopAt - now),
                retryLimit: 0,
                retryNetworkErrors: false,
              },
            });
            return yield* Effect.tryPromise({
              try: async () => {
                if (
                  (response.status !== 200 && response.status !== 301) ||
                  response.redirected ||
                  response.headers.has("content-range") ||
                  (response.url && response.url !== current) ||
                  response.headers
                    .get("content-type")
                    ?.split(";")[0]
                    ?.trim()
                    .toLowerCase() !== "text/html"
                ) {
                  await response.body?.cancel();
                  throw new Error(
                    `Expected complete anonymous HTTP 200 HTML or the exact native 301, received ${response.status} from ${current}`,
                  );
                }
                const maximum = BRANDYWINE_MAX_RESPONSE_BYTES - totalBytes;
                const length = response.headers.get("content-length");
                // Every saved native 301 has an empty body, often without a length.
                const html =
                  response.status === 301 &&
                  response.body === null &&
                  (length === null || length === "0")
                    ? ""
                    : await readIPullUPullResponseText(
                        response,
                        "Brandywine " + current,
                        deadline,
                        maximum,
                      );
                const body = brandywineBody(html);
                totalBytes += body.bytes;
                if (response.status === 200)
                  return { status: 200 as const, html, body };
                const target = URL.parse(
                  response.headers.get("location") ?? "",
                  current,
                )?.href;
                if (step !== 0 || !target || target !== brandywineRedirect(url))
                  throw new Error(
                    "Unexpected native redirect destination, status or additional hop",
                  );
                return { status: 301 as const, target, body };
              },
              catch: (cause) => cause,
            });
          }),
        );
        wires.push({ url: current, status: result.status, body: result.body });
        if (result.status === 200)
          return {
            html: result.html,
            receipt: {
              requestUrl: url,
              finalUrl: current,
              wires,
            } satisfies BrandywineReceipt,
          };
        current = result.target;
      }
      return yield* Effect.fail(
        new Error("Native redirect did not terminate in complete HTML"),
      );
    }).pipe(
      Effect.timeoutFail({
        duration: "25 seconds",
        onTimeout: () =>
          new Error(
            "Combined native request, redirect and body deadline exceeded 25 seconds",
          ),
      }),
    );
  }).pipe(
    Effect.mapError(
      (cause) => new BrandywineProviderError({ operation: url, cause }),
    ),
  );
}
