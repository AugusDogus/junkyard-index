import { Hyperbrowser } from "@hyperbrowser/sdk";
import { chromium } from "playwright-core";
import { Effect } from "effect";
import {
  VANDERHAAGS_CATALOG_PATH,
  VANDERHAAGS_ORIGIN,
} from "./vanderhaags-catalog";

const userAgent =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export interface VanderHaagsPageSource<E = Error> {
  fetchPage(path: string): Effect.Effect<string, E>;
}

export function acquireVanderHaagsSession(apiKey: string) {
  return Effect.gen(function* () {
    const client = new Hyperbrowser({ apiKey });
    const session = yield* Effect.acquireRelease(
      Effect.tryPromise(() =>
        client.sessions.create({
          useStealth: true,
          acceptCookies: true,
          region: "us-west",
        }),
      ),
      (s) =>
        Effect.tryPromise(() => client.sessions.stop(s.id)).pipe(Effect.orDie),
    );
    const browser = yield* Effect.acquireRelease(
      Effect.tryPromise(() =>
        chromium.connectOverCDP(session.wsEndpoint, { timeout: 45_000 }),
      ),
      (b) => Effect.tryPromise(() => b.close()).pipe(Effect.orDie),
    );
    const context =
      browser.contexts()[0] ??
      (yield* Effect.tryPromise(() => browser.newContext({ userAgent })));
    const page =
      context.pages()[0] ?? (yield* Effect.tryPromise(() => context.newPage()));
    let initialHtml: string | null = yield* Effect.tryPromise(async () => {
      // Normal browser navigation establishes AWS WAF's JavaScript cookie.
      await page.goto(VANDERHAAGS_ORIGIN + VANDERHAAGS_CATALOG_PATH, {
        waitUntil: "domcontentloaded",
        timeout: 60_000,
      });
      await page.waitForSelector("#results .item-card", { timeout: 45_000 });
      return page.content();
    });
    return {
      fetchPage: (path: string) =>
        Effect.gen(function* () {
          const url = URL.parse(path, VANDERHAAGS_ORIGIN);
          if (
            !url ||
            url.origin !== VANDERHAAGS_ORIGIN ||
            url.username ||
            url.password ||
            url.hash ||
            !["/New-Salvage.php", "/detailview.php"].includes(url.pathname)
          )
            return yield* Effect.fail(
              new Error("Invalid Vander Haags inventory destination"),
            );
          if (path === VANDERHAAGS_CATALOG_PATH && initialHtml !== null) {
            const html = initialHtml;
            initialHtml = null;
            return html;
          }
          yield* Effect.sleep("1600 millis");
          const response = yield* Effect.tryPromise(() =>
            page.evaluate(async (path) => {
              const r = await fetch(path, {
                cache: "no-store",
                signal: AbortSignal.timeout(30_000),
                headers: { Accept: "text/html" },
              });
              if (
                r.status !== 200 ||
                r.redirected ||
                r.headers.has("content-range") ||
                r.headers.get("content-type")?.split(";")[0]?.trim() !==
                  "text/html"
              )
                throw new Error(
                  "Vander Haags inventory returned HTTP " +
                    r.status +
                    " or an unexpected response type",
                );
              const html = await r.text();
              if (html.length > 5_000_000)
                throw new Error(
                  "Vander Haags response exceeded the document budget",
                );
              return html;
            }, url.pathname + url.search),
          );
          return response;
        }),
    } satisfies VanderHaagsPageSource;
  });
}
