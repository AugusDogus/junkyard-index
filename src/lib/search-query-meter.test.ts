import { describe, expect, mock, test } from "bun:test";
import type { EndRequest } from "@algolia/client-common";
// The browser build, as client bundles resolve `algoliasearch/lite`. Unlike
// the Node build it keeps a response cache, which the meter must sit below.
import { liteClient } from "algoliasearch/dist/lite/builds/browser";
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

  test("meters a real browser client's network calls, not its cached answers", async () => {
    const meter = SearchQueryMeter.create(() => "/search");
    const send = mock(async () => ({
      content: JSON.stringify({ results: [{ hits: [], nbHits: 0 }] }),
      isTimedOut: false,
      status: 200,
    }));
    const client = liteClient(
      "TESTAPP",
      "test-key",
      SearchQueryMeter.clientOptions(meter, { send }),
    );
    const search = {
      requests: [{ indexName: "vehicles", query: "venza" }],
    };
    await client.search(search);
    await client.search(search);
    expect(send).toHaveBeenCalledTimes(1);
    expect(meter.take()).toEqual({ path: "/search", requests: 1, queries: 1 });
  });
});

describe("SearchQueryMeter.reportPageViews", () => {
  function page() {
    const window = new EventTarget();
    const document = Object.assign(new EventTarget(), {
      visibilityState: "visible" as DocumentVisibilityState,
    });
    const meter = SearchQueryMeter.create(() => "/search");
    const capture = mock(() => undefined);
    const report = SearchQueryMeter.reportPageViews({
      meter,
      capture,
      window,
      document,
    });
    const search = () =>
      meter.record({ data: JSON.stringify({ requests: [{}, {}] }) });
    return { window, document, capture, report, search };
  }

  test("reports a page's usage when it hides", () => {
    const view = page();
    view.search();
    view.window.dispatchEvent(new Event("pagehide"));
    expect(view.capture).toHaveBeenCalledWith({
      path: "/search",
      requests: 1,
      queries: 2,
    });
  });

  test("reports when the tab goes to the background, not when it returns", () => {
    const view = page();
    view.search();
    view.document.dispatchEvent(new Event("visibilitychange"));
    expect(view.capture).not.toHaveBeenCalled();
    view.document.visibilityState = "hidden";
    view.document.dispatchEvent(new Event("visibilitychange"));
    expect(view.capture).toHaveBeenCalledTimes(1);
  });

  test("reports on client navigation, and never an empty page view", () => {
    const view = page();
    view.report();
    expect(view.capture).not.toHaveBeenCalled();
    view.search();
    view.report();
    view.report();
    expect(view.capture).toHaveBeenCalledTimes(1);
  });
});
