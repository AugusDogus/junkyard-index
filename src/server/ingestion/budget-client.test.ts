import { expect, spyOn, test } from "bun:test";
import { Effect } from "effect";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { z } from "zod";
import { readBudgetPage } from "./budget-client";
import { budgetPageUrl } from "./budget-yard-metadata";
const nativeFetch = globalThis.fetch;
const implementation = (
  run: (url: URL | RequestInfo, init?: RequestInit) => Promise<Response>,
) => Object.assign(run, { preconnect: nativeFetch.preconnect });
const samples = z
  .record(z.string())
  .parse(
    JSON.parse(
      gunzipSync(
        readFileSync(
          new URL("./budget-test-fixtures/samples.json.gz", import.meta.url),
        ),
      ).toString(),
    ),
  );
const ford = samples.ford;
if (!ford) throw new Error("Missing offline Ford fixture");
test("Budget retains the native make query while bypassing stale WordPress cache with its qualified User-Agent", async () => {
  const mock = spyOn(globalThis, "fetch").mockImplementation(
    implementation(async (input, init) => {
      const url = new URL(String(input));
      expect(url.origin + url.pathname).toBe(
        "https://budgetupullit.com/current-inventory/",
      );
      expect(url.searchParams.get("make")).toBe("LAND ROVER");
      expect(url.searchParams.get("model")).toBe("");
      expect(url.searchParams.get("ji_census")).toMatch(/^\d+$/);
      const headers = new Headers(init?.headers);
      expect(headers.get("User-Agent")).toBe("Mozilla/5.0");
      expect(headers.get("Cache-Control")).toBe("no-cache");
      expect(init?.redirect).toBe("manual");
      return new Response(ford, {
        headers: { "content-type": "text/html; charset=UTF-8" },
      });
    }),
  );
  try {
    expect(
      await Effect.runPromise(
        readBudgetPage(budgetPageUrl("LAND ROVER"), (e) => e),
      ),
    ).toBe(ford);
    expect(mock).toHaveBeenCalledTimes(1);
  } finally {
    mock.mockRestore();
  }
});
const unsupportedResponses: ResponseInit[] = [
  { status: 403, headers: { "content-type": "text/html" } },
  {
    status: 301,
    headers: { "content-type": "text/html", location: "https://foreign.test/" },
  },
  { status: 200, headers: { "content-type": "application/json" } },
  {
    status: 200,
    headers: { "content-type": "text/html", "content-range": "bytes 0-1/10" },
  },
  {
    status: 200,
    headers: {
      "content-type": "text/html",
      link: '<https://budgetupullit.com/current-inventory/?page=2>; rel="next"',
    },
  },
];
test.each(unsupportedResponses)(
  "Budget fails closed without retry on unsupported HTTP evidence %j",
  async (evidence) => {
    const mock = spyOn(globalThis, "fetch").mockImplementation(
      implementation(async () => new Response("untrusted", evidence)),
    );
    try {
      await expect(
        Effect.runPromise(readBudgetPage(budgetPageUrl("FORD"), (e) => e)),
      ).rejects.toThrow("Expected complete owned HTTP200");
      expect(mock).toHaveBeenCalledTimes(1);
    } finally {
      mock.mockRestore();
    }
  },
);
test("Budget rejects a foreign or filtered graph before requesting it", async () => {
  const mock = spyOn(globalThis, "fetch").mockImplementation(
    implementation(async () => {
      throw new Error("No network permitted");
    }),
  );
  try {
    for (const url of [
      "https://foreign.test/current-inventory/?make=FORD&model=",
      "https://budgetupullit.com/current-inventory/?make=FORD&model=FOCUS",
    ])
      await expect(
        Effect.runPromise(readBudgetPage(url, (e) => e)),
      ).rejects.toThrow("outside");
    expect(mock).not.toHaveBeenCalled();
  } finally {
    mock.mockRestore();
  }
});
