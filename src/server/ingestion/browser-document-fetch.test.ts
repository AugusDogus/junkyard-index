import { afterEach, expect, test } from "bun:test";
import { type Duration, Effect, Fiber, TestClock, TestContext } from "effect";
import { z } from "zod";
import {
  browserDocumentResponse,
  navigateBrowserPage,
  pageDocumentFetch,
} from "./browser-document-fetch";
import { URGIIS_TENANTS } from "./urgiis-configuration";
import { urgiisRequestGate } from "./urgiis-client";
import { URG_HOST_POLICY } from "./shared-provider-host";
import { HyperbrowserCapacityError } from "./hyperbrowser-session";
import { fetchSix03Page } from "./six03-client";
import { SIX03_CONTACT, SIX03_ORIGIN } from "./six03-yard-metadata";
import { fetchMichigantruckPage } from "./michigantruck-client";
import { MICHIGANTRUCK_ORIGIN } from "./michigantruck-yard-metadata";
import type { ProviderRequestGate } from "./provider-http-client";

const originalFetch = globalThis.fetch;
const direct: ProviderRequestGate = (request) => request;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

/** Stands in for the Hyperbrowser page: the in-page script runs under Bun
 * against a stubbed global fetch, exactly as Playwright would run it. */
function page(respond: (url: string, init?: RequestInit) => Response) {
  const requests: { url: string; init?: RequestInit }[] = [];
  globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      requests.push({ url, init });
      const response = respond(url, init);
      // A real browser reports the answered URL; synthetic Responses do not.
      Object.defineProperty(response, "url", { value: url });
      return response;
    },
    { preconnect: originalFetch.preconnect },
  );
  let evaluations = 0;
  return {
    requests,
    evaluations: () => evaluations,
    page: {
      evaluate<Input, Output>(
        script: (input: Input) => Output | Promise<Output>,
        input: Input,
      ) {
        evaluations++;
        return Promise.resolve(script(input));
      },
    },
  };
}

test("a Cloudflare-fronted page read in the browser passes the client's own validation", async () => {
  const browser = page(
    () =>
      new Response("<html>contact</html>", {
        headers: {
          "content-type": "text/html; charset=UTF-8",
          // The browser decodes bodies; the compressed length must not leak
          // into the client's complete-body check.
          "content-encoding": "gzip",
          "content-length": "12",
        },
      }),
  );
  const fetchDocument = pageDocumentFetch(browser.page, SIX03_ORIGIN);
  expect(
    await Effect.runPromise(
      fetchSix03Page(SIX03_CONTACT, direct, fetchDocument),
    ),
  ).toBe("<html>contact</html>");
  expect(browser.requests).toHaveLength(1);
  expect(browser.requests[0]?.url).toBe(SIX03_CONTACT);
  expect(browser.requests[0]?.init).toMatchObject({
    method: "GET",
    redirect: "manual",
    credentials: "same-origin",
    headers: { Accept: "text/html" },
  });
});

test("the browser transport refuses other origins before touching the page", async () => {
  const browser = page(() => new Response("unused"));
  const fetchDocument = pageDocumentFetch(browser.page, SIX03_ORIGIN);
  await expect(
    fetchDocument("https://foreign.test/", { method: "GET" }),
  ).rejects.toThrow("refused https://foreign.test/");
  expect(browser.evaluations()).toBe(0);
});

test("a challenge still answered in the browser is refused by the client", async () => {
  const browser = page(
    () =>
      new Response("Just a moment...", {
        status: 403,
        headers: { "content-type": "text/html", "cf-mitigated": "challenge" },
      }),
  );
  const result = await Effect.runPromise(
    fetchMichigantruckPage(
      MICHIGANTRUCK_ORIGIN + "/contact/",
      direct,
      pageDocumentFetch(browser.page, MICHIGANTRUCK_ORIGIN, 1),
    ).pipe(Effect.either),
  );
  expect(result._tag).toBe("Left");
  if (result._tag === "Left")
    expect(result.left.message).toContain("received 403");
});

test("browser results keep refusal semantics for redirects, foreign answers and transport failures", () => {
  const url = SIX03_CONTACT;
  expect(() => browserDocumentResponse(url, { kind: "redirect" })).toThrow(
    "redirects are refused",
  );
  expect(() => browserDocumentResponse(url, { kind: "oversized" })).toThrow(
    "exceeded",
  );
  expect(() =>
    browserDocumentResponse(url, {
      kind: "response",
      status: 200,
      url: SIX03_ORIGIN + "/elsewhere/",
      headers: [["content-type", "text/html"]],
      body: "",
    }),
  ).toThrow("other destinations are refused");
  expect(() =>
    browserDocumentResponse(url, { kind: "network", message: "reset" }),
  ).toThrow(TypeError);
  const limited = browserDocumentResponse(url, {
    kind: "response",
    status: 429,
    url,
    headers: [["retry-after", "120"]],
    body: btoa("slow down"),
  });
  expect(limited.status).toBe(429);
  expect(limited.headers.get("retry-after")).toBe("120");
});

test("an intermittent Cloudflare challenge inside the browser is retried, then validated", async () => {
  let calls = 0;
  const browser = page(() =>
    ++calls < 3
      ? new Response("Just a moment...", {
          status: 403,
          headers: { "content-type": "text/html", "cf-mitigated": "challenge" },
        })
      : new Response("<html>contact</html>", {
          headers: { "content-type": "text/html" },
        }),
  );
  expect(
    await Effect.runPromise(
      fetchSix03Page(
        SIX03_CONTACT,
        direct,
        pageDocumentFetch(browser.page, SIX03_ORIGIN, 1),
      ),
    ),
  ).toBe("<html>contact</html>");
  expect(calls).toBe(3);
});

test("a persistent challenge or plain denial reaches the client after bounded attempts", async () => {
  for (const [headers, attempts] of [
    [{ "content-type": "text/html", "cf-mitigated": "challenge" }, 3],
    [{ "content-type": "text/html" }, 1],
  ] as const) {
    let calls = 0;
    const browser = page(() => {
      calls++;
      return new Response("denied", { status: 403, headers });
    });
    const result = await Effect.runPromise(
      fetchSix03Page(
        SIX03_CONTACT,
        direct,
        pageDocumentFetch(browser.page, SIX03_ORIGIN, 1),
      ).pipe(Effect.either),
    );
    expect(result._tag).toBe("Left");
    expect(calls).toBe(attempts);
  }
});

test("a client deadline also aborts the request running inside the page", async () => {
  let pageSignal: AbortSignal | null | undefined;
  globalThis.fetch = Object.assign(
    async (_input: RequestInfo | URL, init?: RequestInit) => {
      pageSignal = init?.signal;
      return new Promise<Response>((_resolve, reject) =>
        init?.signal?.addEventListener(
          "abort",
          () => reject(new Error("aborted")),
          {
            once: true,
          },
        ),
      );
    },
    { preconnect: originalFetch.preconnect },
  );
  const fakePage = {
    evaluate<Input, Output>(
      script: (input: Input) => Output | Promise<Output>,
      input: Input,
    ) {
      return Promise.resolve(script(input));
    },
  };
  const deadline = new AbortController();
  const pending = pageDocumentFetch(fakePage, SIX03_ORIGIN)(SIX03_CONTACT, {
    method: "GET",
    signal: deadline.signal,
  });
  await new Promise((resolve) => setTimeout(resolve, 5));
  expect(pageSignal?.aborted).toBe(false);
  deadline.abort(new DOMException("deadline", "TimeoutError"));
  await expect(pending).rejects.toThrow("deadline");
  expect(pageSignal?.aborted).toBe(true);
});

/** Records the navigation's position relative to the gate around it. */
function navigationPage(
  events: string[],
  load: Promise<void> = Promise.resolve(),
) {
  return {
    goto: async (url: string) => {
      events.push("goto " + url);
      await load;
    },
    waitForFunction: async () => {
      events.push("challenge wait");
    },
    close: async () => {
      events.push("page closed");
    },
  };
}
const recordingGate =
  (events: string[], queue: Duration.DurationInput = 0): ProviderRequestGate =>
  (request) =>
    Effect.sleep(queue).pipe(
      Effect.zipRight(Effect.sync(() => events.push("gate admits"))),
      Effect.zipRight(request),
      Effect.ensuring(Effect.sync(() => events.push("gate releases"))),
    );
/** Yields to pending promises, then advances the test clock. */
const tick = (step: Duration.DurationInput) =>
  Effect.promise(() => new Promise((resolve) => setTimeout(resolve, 1))).pipe(
    Effect.zipRight(TestClock.adjust(step)),
  );

test("the origin navigation and its challenge wait run inside the source's request gate", async () => {
  const events: string[] = [];
  await Effect.runPromise(
    navigateBrowserPage(
      navigationPage(events),
      SIX03_ORIGIN,
      recordingGate(events),
    ),
  );
  expect(events).toEqual([
    "gate admits",
    `goto ${SIX03_ORIGIN}/`,
    "challenge wait",
    "gate releases",
  ]);
});

test("United's origin navigation holds the shared URG host lease and the tenant's pacing", async () => {
  const united = URGIIS_TENANTS.find((tenant) => tenant.code === "united");
  if (!united) throw new Error("United tenant is missing");
  const events: string[] = [];
  const environment = {
    VERCEL: process.env.VERCEL,
    UPSTASH_REDIS_REST_URL: process.env.UPSTASH_REDIS_REST_URL,
    UPSTASH_REDIS_REST_TOKEN: process.env.UPSTASH_REDIS_REST_TOKEN,
  };
  process.env.VERCEL = "1";
  process.env.UPSTASH_REDIS_REST_URL = "https://redis.invalid";
  process.env.UPSTASH_REDIS_REST_TOKEN = "offline";
  // Stands in for Upstash (which auto-pipelines): every EVAL succeeds, and
  // its first key names the lease.
  globalThis.fetch = Object.assign(
    async (_input: RequestInfo | URL, init?: RequestInit) => {
      const commands = z
        .array(
          z
            .tuple([z.string(), z.string(), z.number(), z.string()])
            .rest(z.unknown()),
        )
        .parse(JSON.parse(String(init?.body)));
      for (const [command, script, , key] of commands)
        events.push(
          `${command} ${script.includes("ZADD") ? "reserve" : "release"} ${key}`,
        );
      return Response.json(commands.map(() => ({ result: 1 })));
    },
    { preconnect: originalFetch.preconnect },
  );
  try {
    await Effect.runPromise(
      Effect.gen(function* () {
        const fiber = yield* Effect.fork(
          navigateBrowserPage(
            navigationPage(events),
            united.origin,
            urgiisRequestGate(united.origin, united),
          ),
        );
        let elapsed = 0;
        while ((yield* Fiber.poll(fiber))._tag === "None") {
          yield* Effect.promise(
            () => new Promise((resolve) => setTimeout(resolve, 1)),
          );
          if ((yield* Fiber.poll(fiber))._tag === "Some") break;
          // Logged before the adjustment, so the step that ends a sleep
          // precedes whatever that sleep releases.
          elapsed += 100;
          events.push(`clock ${elapsed}`);
          yield* TestClock.adjust("100 millis");
        }
        yield* Fiber.join(fiber);
      }).pipe(Effect.provide(TestContext.TestContext)),
    );
  } finally {
    for (const [name, value] of Object.entries(environment))
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
  }
  const significant = events.filter((event) => !event.startsWith("clock"));
  expect(significant).toEqual([
    "eval reserve ingestion:host:urg-iis:v1",
    `goto ${united.origin}/`,
    "challenge wait",
    "eval release ingestion:host:urg-iis:v1",
  ]);
  // The lease is held through the URG host gap, then the tenant pacing runs.
  const released = events.indexOf("eval release ingestion:host:urg-iis:v1");
  const clocks = (from: number, to: number) =>
    events.slice(from, to).filter((event) => event.startsWith("clock")).length;
  expect(clocks(0, released) * 100).toBeGreaterThanOrEqual(
    URG_HOST_POLICY.gapMs,
  );
  expect(clocks(released, events.length) * 100).toBeGreaterThanOrEqual(
    united.pacingMs,
  );
});

test("a request gate that admits nothing in time defers the chunk without navigating", async () => {
  const events: string[] = [];
  const result = await Effect.gen(function* () {
    const fiber = yield* Effect.fork(
      navigateBrowserPage(
        navigationPage(events),
        SIX03_ORIGIN,
        recordingGate(events, "10 minutes"),
      ),
    );
    for (let step = 0; step < 4; step++) yield* tick("1 minute");
    return yield* Effect.either(Fiber.join(fiber));
  }).pipe(Effect.provide(TestContext.TestContext), Effect.runPromise);
  if (result._tag !== "Left") throw new Error("expected a deferral");
  expect(result.left).toBeInstanceOf(HyperbrowserCapacityError);
  expect(events).toEqual(["gate releases"]);
});

test("a navigation admitted late in the queue window still gets its full load time", async () => {
  const events: string[] = [];
  let finishLoad = () => {};
  const load = new Promise<void>((resolve) => {
    finishLoad = resolve;
  });
  const result = await Effect.gen(function* () {
    const fiber = yield* Effect.fork(
      navigateBrowserPage(
        navigationPage(events, load),
        SIX03_ORIGIN,
        recordingGate(events, "149 seconds"),
      ),
    );
    yield* tick("149 seconds");
    yield* tick("50 seconds");
    expect((yield* Fiber.poll(fiber))._tag).toBe("None");
    finishLoad();
    yield* tick("1 second");
    return yield* Effect.either(Fiber.join(fiber));
  }).pipe(Effect.provide(TestContext.TestContext), Effect.runPromise);
  expect(result._tag).toBe("Right");
  expect(events).toEqual([
    "gate admits",
    `goto ${SIX03_ORIGIN}/`,
    "challenge wait",
    "gate releases",
  ]);
});

test("an interrupted navigation closes the page before the gate releases its lease", async () => {
  const events: string[] = [];
  await Effect.gen(function* () {
    const fiber = yield* Effect.fork(
      navigateBrowserPage(
        navigationPage(events, new Promise<void>(() => {})),
        SIX03_ORIGIN,
        recordingGate(events),
      ),
    );
    yield* tick("1 second");
    yield* Fiber.interrupt(fiber);
  }).pipe(Effect.provide(TestContext.TestContext), Effect.runPromise);
  expect(events).toEqual([
    "gate admits",
    `goto ${SIX03_ORIGIN}/`,
    "page closed",
    "gate releases",
  ]);
});
