import { expect, test } from "bun:test";
import {
  IPULLUPULL_MAX_RESPONSE_BYTES,
  readIPullUPullResponseText,
} from "./ipullupull-response-text";

const signal = () => new AbortController().signal;

test("decodes split UTF-8 characters and checks complete byte length", async () => {
  const bytes = new TextEncoder().encode("café\n");
  const response = new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice(0, 4));
        controller.enqueue(bytes.slice(4));
        controller.close();
      },
    }),
    { headers: { "content-length": String(bytes.length) } },
  );
  expect(await readIPullUPullResponseText(response, "CSV", signal())).toBe(
    "café\n",
  );
  expect(response.body?.locked).toBe(false);
});

test.each(["100", "1", "invalid"])(
  "rejects inconsistent content-length %s",
  async (length) => {
    const response = new Response("body", {
      headers: { "content-length": length },
    });
    await expect(
      readIPullUPullResponseText(response, "media page 1", signal()),
    ).rejects.toThrow("Incomplete media page 1");
    expect(response.body?.locked).toBe(false);
  },
);

test("does not compare compressed wire length to decompressed body size", async () => {
  const response = new Response("body", {
    headers: { "content-length": "100", "content-encoding": "gzip" },
  });
  expect(await readIPullUPullResponseText(response, "CSV", signal())).toBe(
    "body",
  );
});

test("rejects invalid UTF-8 and releases the reader", async () => {
  const response = new Response(new Uint8Array([0xc3, 0x28]));
  await expect(
    readIPullUPullResponseText(response, "CSV", signal()),
  ).rejects.toThrow();
  expect(response.body?.locked).toBe(false);
});

test("bounds cumulative chunks, cancels unread bytes, and releases the reader", async () => {
  let cancelled = false;
  const response = new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(IPULLUPULL_MAX_RESPONSE_BYTES));
        controller.enqueue(new Uint8Array(1));
      },
      cancel() {
        cancelled = true;
      },
    }),
  );
  await expect(
    readIPullUPullResponseText(response, "CSV", signal()),
  ).rejects.toThrow("4 MiB");
  expect(cancelled).toBe(true);
  expect(response.body?.locked).toBe(false);
});

test.each([false, true])(
  "aborting a stalled body cancels and unlocks the reader (pre-aborted=%s)",
  async (preAborted) => {
    let cancelled = false;
    const controller = new AbortController();
    const reason = new Error("checkpoint interrupted");
    const response = new Response(
      new ReadableStream<Uint8Array>({
        cancel() {
          cancelled = true;
        },
      }),
    );
    if (preAborted) controller.abort(reason);
    const result = readIPullUPullResponseText(
      response,
      "media page 1",
      controller.signal,
    );
    if (!preAborted) controller.abort(reason);
    await expect(result).rejects.toThrow("checkpoint interrupted");
    expect(cancelled).toBe(true);
    expect(response.body?.locked).toBe(false);
  },
);

test("releases an errored reader even when cancel also rejects", async () => {
  const response = new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(new Error("connection lost"));
      },
    }),
  );
  await expect(
    readIPullUPullResponseText(response, "CSV", signal()),
  ).rejects.toThrow("connection lost");
  expect(response.body?.locked).toBe(false);
});

test("rejects missing bodies", async () => {
  await expect(
    readIPullUPullResponseText(new Response(null), "CSV", signal()),
  ).rejects.toThrow("CSV has no body");
});
