import { describe, expect, mock, test } from "bun:test";
import type { EndRequest } from "@algolia/client-common";
// The browser build, as client bundles resolve `algoliasearch/lite`.
import { liteClient } from "algoliasearch/dist/lite/builds/browser";
import { z } from "zod";
import { SearchRequestMemo } from "./search-request-memo";

const sentBody = z.object({
  requests: z.array(
    z
      .object({ indexName: z.string(), page: z.number().optional() })
      .passthrough(),
  ),
});

/** Answers like Algolia, one result per request, and records each call. */
function fakeAlgolia(status = 200) {
  return mock(async (request: EndRequest) => {
    const { requests } = sentBody.parse(JSON.parse(request.data ?? "{}"));
    return {
      status,
      isTimedOut: false,
      content:
        status === 200
          ? JSON.stringify({
              results: requests.map((inner) => ({
                index: inner.indexName,
                hits: [{ objectID: `${inner.indexName}-${inner.page ?? 0}` }],
                nbHits: 1,
                page: inner.page ?? 0,
              })),
            })
          : JSON.stringify({ message: "Bad request", status }),
    };
  });
}

const hits = { indexName: "vehicles_newest", query: "volvo", hitsPerPage: 24 };
const count = { indexName: "vehicles_newest", query: "volvo", hitsPerPage: 0 };

function setup(options: { now?: () => number; status?: number } = {}) {
  const send = fakeAlgolia(options.status);
  const client = liteClient("APP", "key-a", {
    requester: SearchRequestMemo.create({ send }, { now: options.now }),
  });
  return { send, client };
}

describe("SearchRequestMemo", () => {
  test("answers a search this tab already ran, even when it comes without its counts", async () => {
    const { send, client } = setup();
    const first = await client.search({ requests: [hits, count] });
    const again = await client.search({ requests: [hits] });
    expect(send).toHaveBeenCalledTimes(1);
    expect(again.results).toEqual(first.results.slice(0, 1));
  });

  test("shares one call between identical searches in flight", async () => {
    const { send, client } = setup();
    const [withCount, alone] = await Promise.all([
      client.search({ requests: [hits, count] }),
      client.search({ requests: [hits] }),
    ]);
    expect(send).toHaveBeenCalledTimes(1);
    expect(alone.results).toEqual(withCount.results.slice(0, 1));
  });

  test("sends only the searches it has not answered", async () => {
    const { send, client } = setup();
    await client.search({ requests: [hits] });
    const next = await client.search({
      requests: [hits, { ...hits, page: 1 }],
    });
    expect(send).toHaveBeenCalledTimes(2);
    expect(
      sentBody.parse(JSON.parse(send.mock.calls[1]?.[0].data ?? "{}")).requests,
    ).toEqual([{ ...hits, page: 1 }]);
    expect(next.results).toHaveLength(2);
  });

  test("searches again with another key, since a key carries plan limits", async () => {
    const { send, client } = setup();
    await client.search({ requests: [hits] });
    client.setClientApiKey({ apiKey: "key-b" });
    await client.search({ requests: [hits] });
    expect(send).toHaveBeenCalledTimes(2);
  });

  test("searches again once an answer is five minutes old", async () => {
    let nowMs = 0;
    const { send, client } = setup({ now: () => nowMs });
    // A different body, so the client's own cache cannot answer the second.
    await client.search({ requests: [hits, count] });
    nowMs = 5 * 60_000 + 1;
    await client.search({ requests: [hits] });
    expect(send).toHaveBeenCalledTimes(2);
  });

  test("does not remember a refused search", async () => {
    const { send, client } = setup({ status: 400 });
    await expect(client.search({ requests: [hits] })).rejects.toThrow();
    await expect(client.search({ requests: [hits] })).rejects.toThrow();
    expect(send).toHaveBeenCalledTimes(2);
  });
});
