import { afterEach, expect, test } from "bun:test";
import { Effect, Either, Fiber, TestClock, TestContext } from "effect";
import {
  fetchPullNSaveYardList,
  parsePullNSaveYardList,
  PullNSaveYardListChallengeError,
} from "./pullnsave-yard-list";

const html = await Bun.file(
  new URL("./fixtures/pullnsave-yard-list.html", import.meta.url),
).text();
const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("reads only inventory yard IDs and excludes the All Yards sentinel", () => {
  const parsed = parsePullNSaveYardList(
    `<select id="makes"><option value="8">Pontiac</option></select>${html}`,
  );
  expect([...parsed.yardNumbers].sort((a, b) => a - b)).toEqual([
    1, 2, 3, 4, 5, 6, 7, 9,
  ]);
  expect(parsed.nonce).toBe("fixture-nonce");
  expect(parsed.yardNumbers.has(8)).toBe(false);
});

test.each([
  ["missing selector", html.replace('id="pns_yard"', 'id="different"')],
  ["false ID attribute", html.replace('id="pns_yard"', 'data-id="pns_yard"')],
  ["duplicate selector", html + html],
  ["unclosed selector", html.replace("</select>", "")],
  ["unclosed option", html.replace("</option>", "")],
  ["empty list", html.replace(/<option\b[^>]*>[\s\S]*?<\/option>/g, "")],
  [
    "only All Yards",
    html.replace(/<option value="[1-9]"[^>]*>[\s\S]*?<\/option>/g, ""),
  ],
  ["duplicate ID", html.replace('value="9"', 'value="1"')],
  ["invalid ID", html.replace('value="9"', 'value="9oops"')],
  ["missing value", html.replace('value="9"', 'data-value="9"')],
  ["missing bootstrap", html.replace(/<script>[\s\S]*?<\/script>/, "")],
  ["unclosed comment", html + "<!--"],
])("rejects %s instead of treating yards as removed", (_name, fixture) => {
  expect(() => parsePullNSaveYardList(fixture)).toThrow();
});

// Captured 2026-11-19 from the host's SiteGround anti-bot layer, which
// intermittently serves this 2xx page instead of /inventory/ to production.
const challenge = await Bun.file(
  new URL("./fixtures/pullnsave-yard-list-challenge.html", import.meta.url),
).text();

function serveSequence(bodies: readonly string[]) {
  let calls = 0;
  globalThis.fetch = Object.assign(
    async () => {
      const body = bodies[Math.min(calls, bodies.length - 1)] ?? "";
      calls += 1;
      return new Response(body, {
        status: body === challenge ? 202 : 200,
        headers: body === challenge ? { "sg-captcha": "challenge" } : {},
      });
    },
    { preconnect: originalFetch.preconnect },
  );
  return () => calls;
}

function fetchWithTestClock() {
  return Effect.runPromise(
    Effect.gen(function* () {
      const fiber = yield* fetchPullNSaveYardList((request) => request).pipe(
        Effect.either,
        Effect.fork,
      );
      yield* TestClock.adjust("5 minutes");
      return yield* Fiber.join(fiber);
    }).pipe(Effect.provide(TestContext.TestContext)),
  );
}

test("retries a SiteGround bot challenge and parses the real page after it", async () => {
  const calls = serveSequence([challenge, html]);
  const result = await fetchWithTestClock();
  expect(Either.isRight(result)).toBe(true);
  if (Either.isRight(result))
    expect([...result.right.yardNumbers].sort((a, b) => a - b)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 9,
    ]);
  expect(calls()).toBe(2);
});

test("reports a persistent SiteGround bot challenge as a transient block, not a missing selector", async () => {
  const calls = serveSequence([challenge]);
  const result = await fetchWithTestClock();
  expect(Either.isLeft(result)).toBe(true);
  if (Either.isLeft(result)) {
    expect(result.left).toBeInstanceOf(PullNSaveYardListChallengeError);
    expect(result.left.message).toContain("SiteGround bot challenge");
    expect(result.left.message).not.toContain("#pns_yard");
  }
  expect(calls()).toBe(3);
});

test.each([
  { status: 403 },
  { status: 206 },
  { headers: { "content-range": "bytes 0-10/100" } },
])("rejects failed or partial directory responses", async (init) => {
  globalThis.fetch = Object.assign(async () => new Response(html, init), {
    preconnect: originalFetch.preconnect,
  });
  await expect(
    Effect.runPromise(fetchPullNSaveYardList((request) => request)),
  ).rejects.toThrow();
});
