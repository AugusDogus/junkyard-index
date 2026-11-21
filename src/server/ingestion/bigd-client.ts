import { Data, Effect } from "effect";
import { readIPullUPullResponseText } from "./ipullupull-response-text";
import type { ProviderRequestGate } from "./provider-http-client";
import { BIGD_ORIGIN } from "./bigd-yard-metadata";
import { DocumentTransport, type BrowserSessions } from "./document-transport";

export class BigdProviderError extends Data.TaggedError("BigdProviderError")<{
  operation: string;
  cause: unknown;
}> {
  override get message() {
    return `Big D ${this.operation}: ${this.cause instanceof Error ? this.cause.message : String(this.cause)}. Previous inventory and the last validated checkpoint are preserved. Inspect the native response before restarting.`;
  }
}
export interface BigdSession {
  cookie: string | null;
}
const serial = Effect.runSync(Effect.makeSemaphore(1));
export const bigdRequestGate: ProviderRequestGate = (request) =>
  serial.withPermits(1)(
    request.pipe(Effect.ensuring(Effect.sleep("4 seconds"))),
  );
export const BIGD_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

/** The public __cf_bm session and these headers are verified together for
 * native HTTP. A browser transport owns its own cookies and headers. Never
 * persist the short-lived cookie in a checkpoint or fixture. */
export function fetchBigdPage(
  path: "/" | "/contact/" | "/inventory/",
  session: BigdSession,
  gate: ProviderRequestGate,
  transport: DocumentTransport = DocumentTransport.native,
) {
  const url = BIGD_ORIGIN + path;
  return gate(
    Effect.suspend(() => {
      const lifetime = new AbortController(),
        deadline = AbortSignal.timeout(25_000);
      let pending: Promise<string> | null = null;
      return Effect.tryPromise({
        try: (interrupted) => {
          const signal = AbortSignal.any([
            lifetime.signal,
            deadline,
            interrupted,
          ]);
          pending = (async () => {
            const response = await transport(url, {
              signal,
              headers: {
                "User-Agent": "JunkyardIndex/1.0",
                Accept: "text/html",
                "Accept-Encoding": "identity",
                Connection: "close",
                Referer: BIGD_ORIGIN + "/",
                ...(session.cookie ? { Cookie: session.cookie } : {}),
              },
            });
            const cookie =
              /(?:^|[,\s])(__cf_bm=[A-Za-z0-9_.-]{1,2048})(?:;|$)/.exec(
                response.headers.get("set-cookie") ?? "",
              )?.[1];
            const bootstrap =
              path === "/" &&
              response.status === 403 &&
              response.headers.get("cf-mitigated") === "challenge" &&
              cookie !== undefined;
            if (
              (!bootstrap && response.status !== 200) ||
              response.redirected ||
              (response.url && response.url !== url) ||
              response.headers.has("content-range") ||
              response.headers
                .get("content-type")
                ?.split(";")[0]
                ?.trim()
                .toLowerCase() !== "text/html"
            ) {
              await response.body?.cancel();
              throw new Error(
                `Expected complete native HTTP 200 HTML at ${url}; received ${response.status}`,
              );
            }
            const body = await readIPullUPullResponseText(
              response,
              "Big D " + path,
              signal,
              BIGD_MAX_RESPONSE_BYTES,
            );
            if (cookie) session.cookie = cookie;
            return body;
          })();
          return pending;
        },
        catch: (cause) =>
          new BigdProviderError({ operation: "request/body " + path, cause }),
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
      );
    }),
  );
}

/** Cloudflare refuses native requests from Vercel and challenges in-page fetch
 * on this host, so a browser session loads every document by navigation. */
export const acquireBigdBrowser = (sessions: BrowserSessions) =>
  DocumentTransport.acquireBrowser(sessions, "navigation");
