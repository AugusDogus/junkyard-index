import { afterEach, expect, test } from "bun:test";
import { Effect } from "effect";
import {
  browserDocumentResponse,
  pageDocumentFetch,
} from "./browser-document-fetch";
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
