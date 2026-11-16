import { expect, test, spyOn } from "bun:test";
import { Effect } from "effect";
import { gunzipSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { z } from "zod";
import { readHarrysPage } from "./harrys-client";
import { harrysPageUrl } from "./harrys-yard-metadata";
import { harrysChallengeCookie } from "./harrys-challenge";
const nativeFetch = globalThis.fetch;
const fetchImplementation = (
  run: (url: URL | RequestInfo, init?: RequestInit) => Promise<Response>,
) => Object.assign(run, { preconnect: nativeFetch.preconnect });
const samples = z
  .record(z.string())
  .parse(
    JSON.parse(
      gunzipSync(
        readFileSync(
          new URL("./harrys-test-fixtures/samples.json.gz", import.meta.url),
        ),
      ).toString(),
    ),
  );
const raw = (name: string) => {
  const value = samples[name];
  if (!value) throw new Error("Missing fixture " + name);
  return value;
};
test("Harry's follows one known cookie challenge with the same User-Agent and returns the complete bounded response", async () => {
  let requests = 0;
  const requestsSeen: RequestInit[] = [];
  const mock = spyOn(globalThis, "fetch").mockImplementation(
    fetchImplementation(async (_url, init) => {
      requestsSeen.push(init ?? {});
      return new Response(requests++ === 0 ? raw("challenge") : raw("first"), {
        status: requests === 1 ? 307 : 200,
        headers: { "content-type": "text/html" },
      });
    }),
  );
  try {
    const result = await Effect.runPromise(
      readHarrysPage(harrysPageUrl(0), (e) => e),
    );
    expect(result).toBe(raw("first"));
    expect(requests).toBe(2);
    expect(new Headers(requestsSeen[0]?.headers).get("User-Agent")).toBe(
      "Mozilla/5.0",
    );
    expect(new Headers(requestsSeen[1]?.headers).get("Cookie")).toBe(
      harrysChallengeCookie(raw("challenge")),
    );
  } finally {
    mock.mockRestore();
  }
});
test("Harry's rejects changed challenges and challenged retries with a clear recovery error", async () => {
  const mock = spyOn(globalThis, "fetch").mockImplementation(
    fetchImplementation(
      async () =>
        new Response(raw("challenge"), {
          status: 307,
          headers: { "content-type": "text/html" },
        }),
    ),
  );
  try {
    await expect(
      Effect.runPromise(readHarrysPage(harrysPageUrl(0), (e) => e)),
    ).rejects.toThrow("Cookie retry remained challenged");
    expect(mock).toHaveBeenCalledTimes(2);
  } finally {
    mock.mockRestore();
  }
});
test("Harry's rejects partial responses and foreign scope before parsing inventory", async () => {
  const mock = spyOn(globalThis, "fetch").mockImplementation(
    fetchImplementation(
      async () =>
        new Response(raw("first"), {
          status: 206,
          headers: {
            "content-type": "text/html",
            "content-range": "bytes 0-100/200",
          },
        }),
    ),
  );
  try {
    await expect(
      Effect.runPromise(readHarrysPage(harrysPageUrl(0), (e) => e)),
    ).rejects.toThrow("HTTP206");
    await expect(
      Effect.runPromise(readHarrysPage("https://foreign.test/", (e) => e)),
    ).rejects.toThrow("outside");
    expect(mock).toHaveBeenCalledTimes(1);
  } finally {
    mock.mockRestore();
  }
});
