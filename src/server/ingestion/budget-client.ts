import { hasHttpPaginationLink } from "./provider-http-pagination";
import { Effect } from "effect";
import { readIPullUPullResponseText } from "./ipullupull-response-text";
import type { ProviderRequestGate } from "./provider-http-client";
import { BUDGET_CATALOG, budgetPageUrl } from "./budget-yard-metadata";

export class BudgetProviderError extends Error {
  readonly tag = "BudgetProviderError";
  constructor(
    readonly operation: string,
    cause: unknown,
  ) {
    super(
      `Budget ${operation}: ${cause instanceof Error ? cause.message : String(cause)}. Prior inventory is preserved; inspect the native evidence and resume from the last validated checkpoint.`,
      { cause },
    );
  }
}
const serial = Effect.runSync(Effect.makeSemaphore(1));
export const budgetRequestGate: ProviderRequestGate = (request) =>
  serial.withPermits(1)(
    request.pipe(Effect.ensuring(Effect.sleep("3500 millis"))),
  );

async function document(url: string, signal: AbortSignal): Promise<string> {
  const target = new URL(url);
  target.searchParams.set("ji_census", String(Date.now()));
  const requestUrl = target.href;
  const response = await fetch(requestUrl, {
    method: "GET",
    redirect: "manual",
    signal,
    headers: {
      "User-Agent": "Mozilla/5.0",
      "Cache-Control": "no-cache",
      Accept: "text/html",
    },
  });
  const expected = "text/html";
  if (
    response.status !== 200 ||
    response.redirected ||
    (response.url && response.url !== requestUrl) ||
    response.headers.has("content-range") ||
    hasHttpPaginationLink(response.headers) ||
    response.headers
      .get("content-type")
      ?.split(";")[0]
      ?.trim()
      .toLowerCase() !== expected
  ) {
    const failure = new Error(
      `Expected complete owned HTTP200 ${expected} at ${url}; received HTTP${response.status}`,
    );
    try {
      await response.body?.cancel();
    } catch (cleanup) {
      throw new AggregateError(
        [failure, cleanup],
        failure.message + "; unread body cancellation also failed",
      );
    }
    throw failure;
  }
  return readIPullUPullResponseText(
    response,
    "Budget " + url,
    signal,
    4 * 1024 * 1024,
  );
}

/** No retries. The gate owns the entire request/body lifetime and completion gap. */
export function readBudgetPage(
  url: string,
  gate: ProviderRequestGate = budgetRequestGate,
) {
  return gate(
    Effect.suspend(() => {
      if (
        !(() => {
          const parsed = URL.parse(url);
          const make = parsed?.searchParams.get("make");
          return (
            parsed &&
            make !== null &&
            make !== undefined &&
            url === budgetPageUrl(make) &&
            parsed.origin === new URL(BUDGET_CATALOG).origin
          );
        })()
      )
        return Effect.fail(
          new BudgetProviderError(
            "destination",
            "URL is outside the verified native inventory controls",
          ),
        );
      const lifetime = new AbortController(),
        deadline = AbortSignal.timeout(20_000);
      let pending: Promise<string> | null = null;
      return Effect.tryPromise({
        try: (interruption) => {
          pending = document(
            url,
            AbortSignal.any([lifetime.signal, deadline, interruption]),
          );
          return pending;
        },
        catch: (cause) => new BudgetProviderError("request/body " + url, cause),
      }).pipe(
        Effect.ensuring(
          Effect.promise(async () => {
            lifetime.abort();
            if (pending)
              await pending.then(
                () => undefined,
                () => undefined,
              );
          }),
        ),
        Effect.timeoutFail({
          duration: "20 seconds",
          onTimeout: () =>
            new BudgetProviderError(
              "request/body " + url,
              "Combined request and body deadline exceeded 20 seconds",
            ),
        }),
      );
    }),
  );
}
