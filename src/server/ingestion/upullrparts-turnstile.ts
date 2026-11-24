import { chromium, type Page } from "playwright-core";
import {
  Clock,
  Data,
  Deferred,
  Effect,
  Option,
  Queue,
  type Scope,
} from "effect";
import {
  DocumentTransport,
  type BrowserOpenError,
  type BrowserSessions,
} from "./document-transport";
import { BrowserSessionError } from "./errors";
import { UPULLRPARTS_INVENTORY_URL } from "./upullrparts-client";

/** Cloudflare verifies a Turnstile token for 300 s after it is issued; a
 * token is spent with this much margin or dropped. */
export const UPULLRPARTS_TOKEN_MAX_AGE_MS = 270_000;

const LOAD_TIMEOUT_MS = 60_000;
const CDP_CONNECT_TIMEOUT_MS = 45_000;
/** Most tokens come within this long of the last one without a click. */
const FIRST_WAIT_MS = 800;
const CLICK_WAIT_MS = 5_000;
const CLICKS_PER_LOAD = 6;
const LOADS_PER_TOKEN = 2;
const RENDERING_RESOURCE_TYPES: ReadonlySet<string> = new Set([
  "image",
  "media",
  "font",
]);

/** A browser for the enclosing scope whose tabs each mint one token per
 * call, in parallel. */
export interface UpullRPartsTurnstileBrowser {
  readonly tabs: readonly (() => Promise<string>)[];
}

/** Opens a token browser for the enclosing scope. */
export type UpullRPartsTurnstileOpen = Effect.Effect<
  UpullRPartsTurnstileBrowser,
  BrowserOpenError,
  Scope.Scope
>;

export class UpullRPartsTokenError extends Data.TaggedError(
  "UpullRPartsTokenError",
)<{ message: string }> {}

export interface UpullRPartsTokens {
  /** The oldest unspent token that Cloudflare still verifies. */
  readonly take: Effect.Effect<
    string,
    UpullRPartsTokenError | BrowserOpenError
  >;
}

type TakeToken =
  | { kind: "token"; token: string }
  | { kind: "pending" }
  | { kind: "missing" };

// Serialized into the page. It must not reference module scope. The page
// script resets the widget after each token so it issues the next one.
function takeToken(): TakeToken {
  const get: unknown = Reflect.get(window, "getTurnstileToken");
  const refresh: unknown = Reflect.get(window, "refreshTurnstile");
  if (typeof get !== "function" || typeof refresh !== "function")
    return { kind: "missing" };
  const token: unknown = Reflect.apply(get, window, []);
  if (typeof token !== "string" || token === "") return { kind: "pending" };
  Reflect.apply(refresh, window, []);
  return { kind: "token", token };
}

const turnstileReady = (page: Page, timeout: number) =>
  page
    .waitForFunction(
      () => Reflect.get(window, "upullTurnstileReady") === true,
      undefined,
      { timeout, polling: 200 },
    )
    .then(
      () => true,
      () => false,
    );

async function loadInventory(page: Page) {
  await page.goto(UPULLRPARTS_INVENTORY_URL, {
    waitUntil: "domcontentloaded",
    timeout: LOAD_TIMEOUT_MS,
  });
  if (page.url().includes("/.well-known/"))
    throw new Error(
      `upullrparts.com served its robot challenge instead of the inventory page (${page.url()}); this session's IP is challenged.`,
    );
  // The vehicle form mounts the Turnstile widget.
  await page
    .getByText("Search By Vehicle")
    .first()
    .click({ timeout: LOAD_TIMEOUT_MS });
}

/** The widget usually needs a click before it issues a token. */
async function clickWidget(page: Page) {
  const widget = page.locator("#upull-turnstile");
  await widget.scrollIntoViewIfNeeded().catch(() => undefined);
  const box = await widget.boundingBox().catch(() => null);
  if (box) await page.mouse.click(box.x + 28, box.y + box.height / 2);
}

async function mint(page: Page): Promise<string> {
  for (let load = 0; load < LOADS_PER_TOKEN; load++) {
    if (load > 0) await loadInventory(page);
    for (let click = 0; click <= CLICKS_PER_LOAD; click++) {
      if (
        await turnstileReady(page, click === 0 ? FIRST_WAIT_MS : CLICK_WAIT_MS)
      ) {
        const taken = await page.evaluate(takeToken);
        if (taken.kind === "token") return taken.token;
        if (taken.kind === "missing")
          throw new Error(
            "the inventory page no longer defines getTurnstileToken and refreshTurnstile; check wp-content/plugins/V5.0/vehicle-search.js for how its search now gets a token",
          );
      }
      if (click < CLICKS_PER_LOAD) await clickWidget(page);
    }
  }
  throw new Error(
    `Turnstile issued no token after ${LOADS_PER_TOKEN} page loads with ${CLICKS_PER_LOAD} widget clicks each`,
  );
}

/**
 * A remote browser session from `sessions`, under its provider's session
 * lease, with `tabs` inventory pages that mint tokens. It connects over CDP
 * itself: minting needs several full Playwright pages, not the single
 * document page `BrowserSessions.connect` prepares. Tabs load one at a time,
 * since parallel loads through a stealth proxy timed out.
 */
function open(
  sessions: BrowserSessions,
  tabs: number,
): UpullRPartsTurnstileOpen {
  return Effect.gen(function* () {
    const session = yield* DocumentTransport.acquireSession(sessions);
    const browser = yield* Effect.acquireRelease(
      Effect.tryPromise({
        try: () =>
          chromium.connectOverCDP(session.wsEndpoint, {
            timeout: CDP_CONNECT_TIMEOUT_MS,
          }),
        catch: (cause) => new BrowserSessionError({ phase: "open", cause }),
      }),
      (b) => Effect.promise(() => b.close().catch(() => undefined)),
    );
    const pages = yield* Effect.tryPromise({
      try: async () => {
        const context = browser.contexts()[0] ?? (await browser.newContext());
        const pages = [context.pages()[0] ?? (await context.newPage())];
        while (pages.length < tabs) pages.push(await context.newPage());
        for (const page of pages) {
          await page.route("**/*", (route) =>
            RENDERING_RESOURCE_TYPES.has(route.request().resourceType())
              ? route.abort()
              : route.continue(),
          );
          await loadInventory(page);
        }
        return pages;
      },
      catch: (cause) => new BrowserSessionError({ phase: "open", cause }),
    });
    return { tabs: pages.map((page) => () => mint(page)) };
  });
}

/**
 * Mints up to `count` tokens, opening the browser on the first `take` and
 * closing it, with its session and lease, once `count` are minted or the
 * scope closes. Tokens are minted ahead of `take`, in parallel across tabs.
 */
function make(
  open: UpullRPartsTurnstileOpen,
  count: number,
): Effect.Effect<UpullRPartsTokens, never, Scope.Scope> {
  return Effect.gen(function* () {
    const scope = yield* Effect.scope;
    const minted = yield* Queue.unbounded<{ token: string; at: number }>();
    // Fails once no more tokens will be minted, with the reason.
    const ended = yield* Deferred.make<
      never,
      UpullRPartsTokenError | BrowserOpenError
    >();
    let expired = 0;
    const exhausted = () =>
      new UpullRPartsTokenError({
        message: `U Pull R Parts spent all ${count} tokens minted for this chunk (${expired} expired before use, after ${UPULLRPARTS_TOKEN_MAX_AGE_MS / 1000} s). The crawl sends no more searches than it mints tokens for, so this chunk sent searches that were not counted; nothing from it was accepted.`,
      });

    const mintAll = Effect.scoped(
      Effect.gen(function* () {
        const browser = yield* open;
        let left = count;
        yield* Effect.forEach(
          browser.tabs,
          (tab) =>
            Effect.gen(function* () {
              while (left > 0) {
                left -= 1;
                const token = yield* Effect.tryPromise({
                  try: tab,
                  catch: (cause) =>
                    new BrowserSessionError({ phase: "fetch", cause }),
                });
                yield* Queue.offer(minted, {
                  token,
                  at: yield* Clock.currentTimeMillis,
                });
              }
            }),
          { concurrency: "unbounded", discard: true },
        );
      }),
    ).pipe(
      Effect.flatMap(() => Effect.fail(exhausted())),
      Effect.catchAll((error) => Deferred.fail(ended, error)),
    );
    const start = yield* Effect.once(
      Effect.asVoid(Effect.forkIn(mintAll, scope)),
    );

    const take: UpullRPartsTokens["take"] = Effect.gen(function* () {
      yield* start;
      while (true) {
        const ready = yield* Queue.poll(minted);
        const next = Option.isSome(ready)
          ? ready.value
          : yield* Effect.raceFirst(Queue.take(minted), Deferred.await(ended));
        const now = yield* Clock.currentTimeMillis;
        if (now - next.at <= UPULLRPARTS_TOKEN_MAX_AGE_MS) return next.token;
        expired += 1;
      }
    }).pipe(
      Effect.catchTag("UpullRPartsTokenError", () => Effect.fail(exhausted())),
    );
    return { take };
  });
}

export const UpullRPartsTokens = { make } as const;

export const UpullRPartsTurnstile = { open } as const;
