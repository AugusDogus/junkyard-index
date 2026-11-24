import type { EndRequest, Requester, Response } from "@algolia/client-common";
import { z } from "zod";

/**
 * Remembers each search inside the browser's multi-query calls, so a search
 * the tab already ran (or is running) is answered without another billed
 * call. Algolia bills every HTTP call, and the client's own response cache
 * only matches whole bodies: the page often repeats one search in a smaller
 * body, because `withSearchCountsCache` leaves out counts it already has
 * (after Back, a plan or capability remount, or a mode switch). This sits
 * below that cache, at the requester, where the bodies are plain JSON.
 */
const LIFETIME_MS = 5 * 60_000;
const MAX_ENTRIES = 100;

const multiQueryBody = z
  .object({ requests: z.array(z.record(z.string(), z.unknown())) })
  .passthrough();
const multiQueryAnswer = z
  .object({ results: z.array(z.unknown()) })
  .passthrough();

type Outcome = { kind: "answered"; result: unknown } | { kind: "failed" };

/** JSON with object keys sorted, so equal searches share one key. */
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (typeof value === "object" && value !== null)
    return `{${Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(",")}}`;
  return JSON.stringify(value) ?? "null";
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * The call's path, query string (which carries the browser's API key) and
 * API key header. Retries go to other hosts, so the host is left out.
 */
function scopeOf(request: EndRequest): string {
  const url = new URL(request.url);
  return [
    url.pathname,
    url.search,
    request.headers["x-algolia-api-key"] ?? "",
  ].join("\n");
}

function isMultiQuery(request: EndRequest): request is EndRequest & {
  data: string;
} {
  return (
    request.method === "POST" &&
    request.data !== undefined &&
    new URL(request.url).pathname === "/1/indexes/*/queries"
  );
}

function answered(
  response: Response,
  sentCount: number,
): z.infer<typeof multiQueryAnswer> | null {
  if (response.isTimedOut || response.status < 200 || response.status >= 300)
    return null;
  const parsed = multiQueryAnswer.safeParse(parseJson(response.content));
  return parsed.success && parsed.data.results.length === sentCount
    ? parsed.data
    : null;
}

function create(
  base: Requester,
  options: { now?: () => number } = {},
): Requester {
  const now = options.now ?? (() => Date.now());
  const settled = new Map<string, { savedAt: number; result: unknown }>();
  const inFlight = new Map<string, Promise<Outcome>>();

  const remember = (key: string, result: unknown) => {
    settled.delete(key);
    settled.set(key, { savedAt: now(), result });
    if (settled.size > MAX_ENTRIES) {
      const oldest = settled.keys().next();
      if (!oldest.done) settled.delete(oldest.value);
    }
  };
  const known = (key: string): Promise<Outcome> | undefined => {
    const entry = settled.get(key);
    if (entry && now() - entry.savedAt < LIFETIME_MS)
      return Promise.resolve({ kind: "answered", result: entry.result });
    if (entry) settled.delete(key);
    return inFlight.get(key);
  };

  return {
    async send(request) {
      if (!isMultiQuery(request)) return base.send(request);
      const body = multiQueryBody.safeParse(parseJson(request.data));
      if (!body.success) return base.send(request);
      const { requests, ...rest } = body.data;
      const scope = `${scopeOf(request)}\n${stableJson(rest)}\n`;
      const keys = requests.map((inner) => scope + stableJson(inner));
      const reused = keys.map(known);
      const missing = requests.flatMap((inner, index) =>
        reused[index] ? [] : [{ inner, key: keys[index] ?? "" }],
      );

      let sent: Promise<Response> | null = null;
      if (missing.length > 0) {
        const call = base.send(
          missing.length === requests.length
            ? request
            : {
                ...request,
                data: JSON.stringify({
                  ...rest,
                  requests: missing.map(({ inner }) => inner),
                }),
              },
        );
        sent = call;
        const outcomes = call.then(
          (response) => answered(response, missing.length),
          () => null,
        );
        missing.forEach(({ key }, index) => {
          const outcome = outcomes.then((answer): Outcome => {
            const result = answer?.results[index];
            return answer ? { kind: "answered", result } : { kind: "failed" };
          });
          inFlight.set(key, outcome);
          void outcome.then((settledOutcome) => {
            if (inFlight.get(key) === outcome) inFlight.delete(key);
            if (settledOutcome.kind === "answered")
              remember(key, settledOutcome.result);
          });
        });
      }

      const response = sent ? await sent : null;
      if (response && missing.length === requests.length) return response;
      const answer = response ? answered(response, missing.length) : null;
      // A refused or unreadable call goes back to the client as it came.
      if (response && !answer) return response;

      let next = 0;
      const results: unknown[] = [];
      for (const outcome of reused) {
        if (!outcome) {
          results.push(answer?.results[next++]);
          continue;
        }
        const shared = await outcome;
        // The call this search shared failed; send the whole body itself.
        if (shared.kind === "failed") return base.send(request);
        results.push(shared.result);
      }
      return {
        status: response?.status ?? 200,
        isTimedOut: false,
        content: JSON.stringify({ ...answer, results }),
      };
    },
  };
}

export const SearchRequestMemo = { create } as const;
