import { expect, test } from "bun:test";
import {
  IPULLUPULL_MAX_RESPONSE_BYTES,
  readBoundedResponseText,
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

test("bounded reader stays strict by default and replaces stray bytes only when asked", async () => {
  const bytes = () => new Uint8Array([0x34, 0xd7, 0x34]);
  await expect(
    readBoundedResponseText(new Response(bytes()), "HTML", signal(), 3),
  ).rejects.toThrow();
  expect(
    await readBoundedResponseText(
      new Response(bytes()),
      "HTML",
      signal(),
      3,
      "utf-8-replace",
    ),
  ).toBe("4\uFFFD4");
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

test("enforces a caller's lower cumulative body limit before reading the tail", async () => {
  const maximumBytes = 2 * 1024 * 1024;
  let cancelled = false;
  const response = new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(maximumBytes));
        controller.enqueue(new Uint8Array(1));
      },
      cancel() {
        cancelled = true;
      },
    }),
  );
  await expect(
    readIPullUPullResponseText(
      response,
      "donor catalog",
      AbortSignal.timeout(1_000),
      maximumBytes,
    ),
  ).rejects.toThrow("2 MiB");
  expect(cancelled).toBe(true);
  expect(response.body?.locked).toBe(false);
});

test.each([0, -1, 1.5, Number.NaN, IPULLUPULL_MAX_RESPONSE_BYTES + 1])(
  "rejects invalid or expanded caller body bound %s before locking the response",
  async (maximumBytes) => {
    const response = new Response("body");
    await expect(
      readIPullUPullResponseText(response, "catalog", signal(), maximumBytes),
    ).rejects.toThrow("response byte limit");
    expect(response.body?.locked).toBe(false);
  },
);

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
