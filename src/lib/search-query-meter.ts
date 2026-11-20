import type { EndRequest, Requester } from "@algolia/client-common";

/**
 * Algolia traffic a browser sent while one page was showing. `requests` is
 * HTTP calls that reached Algolia, retries included; `queries` is the
 * searches inside them (a multi-query call carries several).
 */
export type SearchQueryUsage = {
  path: string;
  requests: number;
  queries: number;
};

/** Searches in one call's body: `{"requests": [...]}` holds one per entry. */
function queriesIn(data: string | undefined): number {
  if (data === undefined) return 1;
  let body: unknown;
  try {
    body = JSON.parse(data);
  } catch {
    return 1;
  }
  return typeof body === "object" &&
    body !== null &&
    "requests" in body &&
    Array.isArray(body.requests)
    ? body.requests.length
    : 1;
}

/**
 * Counts Algolia calls at the transport, below the search client's response
 * cache, so a repeated search answered from memory is not counted. Usage is
 * attributed to the path that was showing when its first call was sent.
 */
function create(currentPath: () => string) {
  let usage: SearchQueryUsage | null = null;
  const record = (request: Pick<EndRequest, "data">): void => {
    usage ??= { path: currentPath(), requests: 0, queries: 0 };
    usage.requests += 1;
    usage.queries += queriesIn(request.data);
  };
  return {
    record,
    /** Wraps a requester so every call it sends is recorded first. */
    requester(base: Requester): Requester {
      return {
        send(request) {
          record(request);
          return base.send(request);
        },
      };
    },
    /** Returns usage since the last call, or null if nothing was sent. */
    take(): SearchQueryUsage | null {
      const taken = usage;
      usage = null;
      return taken;
    },
  };
}

export type SearchQueryMeter = ReturnType<typeof create>;

/**
 * The lite client options that meter a browser client. Its default response
 * cache sits above the requester, so cached answers are not counted.
 */
function clientOptions(meter: SearchQueryMeter, base: Requester) {
  return { requester: meter.requester(base) };
}

/**
 * Sends each page view's usage as one event: when the page hides (closing,
 * reloading, leaving the site), when the tab goes to the background, and when
 * the returned function runs on a client navigation. Nothing is sent for a
 * page that made no Algolia calls.
 */
function reportPageViews(input: {
  meter: SearchQueryMeter;
  capture: (usage: SearchQueryUsage) => void;
  window: Pick<EventTarget, "addEventListener">;
  document: Pick<EventTarget, "addEventListener"> & {
    readonly visibilityState: DocumentVisibilityState;
  };
}): () => void {
  const report = () => {
    const usage = input.meter.take();
    if (usage) input.capture(usage);
  };
  input.window.addEventListener("pagehide", report);
  input.document.addEventListener("visibilitychange", () => {
    if (input.document.visibilityState === "hidden") report();
  });
  return report;
}

export const SearchQueryMeter = {
  create,
  clientOptions,
  reportPageViews,
} as const;

/** This browser's meter; `instrumentation-client.ts` reports it. */
export const searchQueryMeter = SearchQueryMeter.create(() =>
  typeof window === "undefined" ? "" : window.location.pathname,
);
