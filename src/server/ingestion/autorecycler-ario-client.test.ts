import { expect, test } from "bun:test";
import {
  ARIO_HOURLY_REQUEST_BUDGET,
  ArioRateLimit,
  createArioClient,
  type ArioSession,
} from "./autorecycler-ario-client";

for (const [label, header, minimum] of [
  ["seconds", "7200", 7_200_000],
  ["HTTP date", "http-date", 7_190_000],
  ["missing", null, 3_600_000],
  ["malformed", "later", 3_600_000],
] satisfies [string, string | null, number][]) {
  test(`Ario 429 preserves ${label} Retry-After as a resumable wait`, async () => {
    let requests = 0;
    const client = createArioClient({ key: "offline-key" }, async () => {
      requests++;
      return new Response("{}", {
        status: 429,
        headers: header
          ? {
              "Retry-After":
                header === "http-date"
                  ? new Date(Date.now() + 7_200_000).toUTCString()
                  : header,
            }
          : {},
      });
    });
    const before = Date.now();
    try {
      await client.pages(["samson-auto-salvage"], 200);
      throw new Error("Expected rate limit");
    } catch (error) {
      expect(error).toBeInstanceOf(ArioRateLimit);
      if (!(error instanceof ArioRateLimit)) throw error;
      expect(error.retryAt).toBeGreaterThanOrEqual(before + minimum);
    }
    expect(requests).toBe(1);
  });
}

test("the local hourly budget waits without making another provider request, then resets", async () => {
  const session: ArioSession = {
    key: "offline-key",
    requestTimes: Array.from({ length: ARIO_HOURLY_REQUEST_BUDGET }, () =>
      Date.now(),
    ),
    requests: ARIO_HOURLY_REQUEST_BUDGET,
  };
  let requests = 0;
  const client = createArioClient(session, async () => {
    requests++;
    return Response.json({});
  });
  await expect(
    client.pages(["samson-auto-salvage"], 200),
  ).rejects.toBeInstanceOf(ArioRateLimit);
  expect(requests).toBe(0);
  session.requestTimes = session.requestTimes?.map(
    () => Date.now() - 3_602_000,
  );
  await client.pages(["samson-auto-salvage"], 200);
  expect(requests).toBe(1);
  expect(session.requests).toBe(ARIO_HOURLY_REQUEST_BUDGET + 1);
  expect(session.requestTimes).toHaveLength(1);
});

test("new chunk clients reuse persisted bundle discovery and key", async () => {
  const paths: string[] = [];
  const session: ArioSession = {};
  const fetcher = async (url: string) => {
    paths.push(new URL(url).pathname);
    if (url === "https://ario.autorecycler.io")
      return new Response('<script src="/assets/index-test.js"></script>');
    if (url.endsWith(".js")) return new Response('"sb_publishable_offline"');
    return Response.json([]);
  };
  await createArioClient(session, fetcher).yards();
  await createArioClient(session, fetcher).pages(["samson-auto-salvage"], 0);
  expect(paths).toEqual([
    "/",
    "/assets/index-test.js",
    "/rest/v1/yards",
    "/functions/v1/search-inventory",
  ]);
  expect(session.requests).toBe(4);
}, 15_000);

test("saved live probes reject larger limits and retain stable grouped 100-rank windows", async () => {
  for (const limit of [500, 1000]) {
    const response: unknown = await Bun.file(
      new URL(`./fixtures/ario/limit-${limit}.json`, import.meta.url),
    ).json();
    expect(response).toMatchObject({
      error: "Invalid input parameters",
      details: [{ maximum: 100, path: ["per_yard_limit"] }],
    });
  }
  const { gunzipSync } = await import("node:zlib");
  const read = async (name: string): Promise<unknown> => {
    const bytes = await Bun.file(
      new URL(`./fixtures/ario/${name}.json.gz`, import.meta.url),
    ).arrayBuffer();
    return JSON.parse(gunzipSync(new Uint8Array(bytes)).toString());
  };
  expect(await read("group-opening")).toEqual(await read("group-closing"));
  const { z } = await import("zod");
  const schema = z.object({
    items: z.array(
      z.object({ id: z.string(), yard: z.string(), item_rank: z.number() }),
    ),
  });
  const opening = schema.parse(await read("group-opening"));
  const next = schema.parse(await read("group-next"));
  expect(new Set(opening.items.map((item) => item.yard)).size).toBe(2);
  expect(opening.items.every((item) => item.item_rank <= 100)).toBe(true);
  expect(
    next.items.every((item) => item.item_rank > 100 && item.item_rank <= 200),
  ).toBe(true);
  expect(
    next.items.some((item) =>
      opening.items.some((first) => first.id === item.id),
    ),
  ).toBe(false);
});
