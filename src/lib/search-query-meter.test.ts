import { describe, expect, mock, test } from "bun:test";
import type { EndRequest } from "@algolia/client-common";
import { SearchQueryMeter } from "./search-query-meter";

function request(data?: string): EndRequest {
  return {
    url: "https://example-dsn.algolia.net/1/indexes/*/queries",
    method: "POST",
    headers: {},
    connectTimeout: 1000,
    responseTimeout: 2000,
    data,
  };
}

describe("SearchQueryMeter", () => {
  test("counts calls and the searches inside each multi-query body", async () => {
    let path = "/search";
    const meter = SearchQueryMeter.create(() => path);
    const send = mock(async () => ({
      content: "{}",
      isTimedOut: false,
      status: 200,
    }));
    const requester = meter.requester({ send });
    await requester.send(
      request(
        JSON.stringify({ requests: [{ indexName: "a" }, { indexName: "b" }] }),
      ),
    );
    path = "/somewhere-else";
    await requester.send(request(JSON.stringify({ requests: [{}] })));
    expect(send).toHaveBeenCalledTimes(2);
    expect(meter.take()).toEqual({ path: "/search", requests: 2, queries: 3 });
  });

  test("starts over after usage is taken, and reports nothing when idle", () => {
    const meter = SearchQueryMeter.create(() => "/search");
    expect(meter.take()).toBeNull();
    meter.record(request(JSON.stringify({ requests: [{}] })));
    expect(meter.take()).toEqual({ path: "/search", requests: 1, queries: 1 });
    expect(meter.take()).toBeNull();
  });

  test("counts an unreadable or bodyless call as one search", () => {
    const meter = SearchQueryMeter.create(() => "/search");
    meter.record(request("not json"));
    meter.record(request());
    expect(meter.take()).toEqual({ path: "/search", requests: 2, queries: 2 });
  });

  test("records a call even when it fails", async () => {
    const meter = SearchQueryMeter.create(() => "/search");
    const requester = meter.requester({
      send: async () => {
        throw new Error("network down");
      },
    });
    await expect(requester.send(request())).rejects.toThrow("network down");
    expect(meter.take()?.requests).toBe(1);
  });
});
