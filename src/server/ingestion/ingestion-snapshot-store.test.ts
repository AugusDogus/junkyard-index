import { expect, test } from "bun:test";
import { gzipSync } from "node:zlib";
import {
  BlobError,
  BlobServiceNotAvailable,
  BlobServiceRateLimited,
  del,
  get,
  put,
} from "@vercel/blob";
import {
  IngestionSnapshotStore,
  SnapshotDeleteDeadlineError,
  type SnapshotDeletePolicy,
} from "./ingestion-snapshot-store";

/** Cleanup with an hour left on the fake clock. */
const PACED: SnapshotDeletePolicy = { kind: "paced", deadline: 3_600_000 };

/** A clock that only moves when the store sleeps. */
function fakeClock() {
  let now = 0;
  const sleeps: number[] = [];
  return {
    now: () => now,
    sleep: async (ms: number) => {
      sleeps.push(ms);
      now += ms;
    },
    sleeps,
  };
}

/** A Blob SDK whose deletes fail with these errors, in order (null: that
 * call succeeds), before succeeding. */
function deletingBlobStore(failures: readonly (Error | null)[] = []) {
  const remaining = [...failures];
  const calls: { batch: string[]; at: number }[] = [];
  const clock = fakeClock();
  const store = IngestionSnapshotStore.vercelBlob(
    "local-test-token",
    {
      get,
      put,
      async del(urls, options) {
        expect(options?.token).toBe("local-test-token");
        expect(options?.abortSignal).toBeInstanceOf(AbortSignal);
        const batch = typeof urls === "string" ? [urls] : urls;
        if (batch.length > 1_000)
          throw new Error(
            "Vercel Blob: Cannot delete more than 1,000 urls at once",
          );
        const failure = remaining.shift();
        if (failure) throw failure;
        calls.push({ batch, at: clock.now() });
      },
    },
    clock.sleep,
    clock.now,
  );
  return { store, calls, clock };
}

const runPathnames = (count: number) =>
  Array.from(
    { length: count },
    (_, index) => `ingestion-runs/run/urgiis/${index}.json.gz`,
  );

test("Blob delete splits a large run's chunks under the 1,000 URL limit", async () => {
  const blob = deletingBlobStore();
  const pathnames = runPathnames(2_213);

  await blob.store.delete(pathnames, PACED);

  expect(blob.calls.every(({ batch }) => batch.length <= 1_000)).toBe(true);
  expect(blob.calls.flatMap(({ batch }) => batch)).toEqual(pathnames);
});

test("Blob delete paces batches to 1,000 deletes a minute", async () => {
  const blob = deletingBlobStore();

  await blob.store.delete(runPathnames(600), PACED);

  // 250 deletes earn 15 s before the next batch starts.
  expect(
    blob.calls.map(({ batch, at }) => ({ size: batch.length, at })),
  ).toEqual([
    { size: 250, at: 0 },
    { size: 250, at: 15_000 },
    { size: 100, at: 30_000 },
  ]);
});

test("Blob delete paces separate calls on the same store", async () => {
  const blob = deletingBlobStore();

  await blob.store.delete(runPathnames(250), PACED);
  await blob.store.delete(["ingestion-runs/run/urgiis/state.json.gz"], PACED);

  expect(blob.calls.map(({ at }) => at)).toEqual([0, 15_000]);
});

test("Blob delete waits out a rate limit for as long as the store asks", async () => {
  const blob = deletingBlobStore([new BlobServiceRateLimited(60)]);
  const pathnames = runPathnames(10);

  await blob.store.delete(pathnames, PACED);

  expect(blob.calls).toEqual([{ batch: pathnames, at: 60_000 }]);
});

test("Blob delete leaves retrying an unavailable store to the SDK, which already retried it", async () => {
  const blob = deletingBlobStore([new BlobServiceNotAvailable()]);

  await expect(blob.store.delete(runPathnames(1), PACED)).rejects.toThrow(
    BlobServiceNotAvailable,
  );
  expect(blob.clock.sleeps).toEqual([]);
});

test("Blob delete waits the backoff floor when a rate limit's retry-after is unusable, and clamps a huge one", async () => {
  // The SDK parses Retry-After with parseInt, so an HTTP date becomes NaN.
  const unusable = deletingBlobStore([new BlobServiceRateLimited(Number.NaN)]);
  await unusable.store.delete(runPathnames(1), PACED);
  expect(unusable.clock.sleeps).toEqual([5_000]);

  const huge = deletingBlobStore([new BlobServiceRateLimited(86_400)]);
  await huge.store.delete(runPathnames(1), PACED);
  expect(huge.clock.sleeps).toEqual([120_000]);
});

test("a best-effort delete makes one unpaced attempt and gives up on a rate limit without sleeping", async () => {
  const blob = deletingBlobStore([null, null, new BlobServiceRateLimited(60)]);
  // Cleanup just used the pace, so a paced delete would wait 15 s.
  await blob.store.delete(runPathnames(250), PACED);

  await expect(
    blob.store.delete(runPathnames(1), { kind: "best-effort" }),
  ).resolves.toBeUndefined();
  await expect(
    blob.store.delete(runPathnames(1), { kind: "best-effort" }),
  ).rejects.toThrow(BlobServiceRateLimited);

  expect(blob.calls.map(({ at }) => at)).toEqual([0, 0]);
  expect(blob.clock.sleeps).toEqual([]);
});

test("a paced delete stops at its deadline instead of waiting past it", async () => {
  const blob = deletingBlobStore([null, new BlobServiceRateLimited(60)]);
  const pathnames = runPathnames(300);

  const stopped = await blob.store
    .delete(pathnames, { kind: "paced", deadline: 30_000 })
    .catch((error: unknown) => error);

  // The first batch went through; the second needs a 15 s pace, then a
  // 60 s rate limit wait that would end past the deadline.
  expect(stopped).toBeInstanceOf(SnapshotDeleteDeadlineError);
  expect(stopped).toMatchObject({ deleted: 250, remaining: 50 });
  expect(String(stopped)).toMatch(
    /250 of 300 were deleted; the other 50 are still registered/,
  );
  expect(blob.clock.sleeps).toEqual([15_000]);
});

test("a paced delete abandons a request still in flight at its deadline", async () => {
  let signal: AbortSignal | undefined;
  const store = IngestionSnapshotStore.vercelBlob(
    "local-test-token",
    {
      get,
      put,
      // An SDK still sleeping between its own retries never settles.
      del: (_urls, options) => {
        signal = options?.abortSignal;
        return new Promise(() => {});
      },
    },
    async () => {},
    () => 0,
  );

  await expect(
    store.delete(runPathnames(1), { kind: "paced", deadline: 20 }),
  ).rejects.toBeInstanceOf(SnapshotDeleteDeadlineError);
  expect(signal?.aborted).toBe(true);
});

test("concurrent paced deletes in one process queue behind each other", async () => {
  const blob = deletingBlobStore();

  await Promise.all([
    blob.store.delete(runPathnames(250), PACED),
    blob.store.delete(["ingestion-runs/run/urgiis/state.json.gz"], PACED),
  ]);

  expect(blob.calls.map(({ at }) => at)).toEqual([0, 15_000]);
});

test("Blob delete gives up after its retry budget and says what was deleted", async () => {
  const clock = fakeClock();
  let attempts = 0;
  const deleted: string[][] = [];
  const store = IngestionSnapshotStore.vercelBlob(
    "local-test-token",
    {
      get,
      put,
      async del(urls) {
        attempts += 1;
        // The first batch goes through; the store then keeps rate limiting.
        if (attempts > 1) throw new BlobServiceRateLimited(60);
        deleted.push(typeof urls === "string" ? [urls] : urls);
      },
    },
    clock.sleep,
    clock.now,
  );

  await expect(store.delete(runPathnames(300), PACED)).rejects.toThrow(
    /Could not delete 50 staged snapshot blobs: Vercel Blob was still rate limiting after 6 attempts.*250 of 300 were deleted; the other 50 are still in Blob storage/,
  );
  expect(deleted.map((batch) => batch.length)).toEqual([250]);
  expect(attempts).toBe(7);
});

test("Blob delete does not retry a request the store rejects", async () => {
  const blob = deletingBlobStore([new BlobError("Access denied")]);

  await expect(blob.store.delete(runPathnames(1), PACED)).rejects.toThrow(
    "Access denied",
  );
  expect(blob.clock.sleeps).toEqual([]);
});

test("Blob delete makes no request for no chunks", async () => {
  let requests = 0;
  const store = IngestionSnapshotStore.vercelBlob("local-test-token", {
    get,
    put,
    async del() {
      requests += 1;
    },
  });

  await store.delete([], PACED);

  expect(requests).toBe(0);
});

function blobResponse(pathname: string, body: Uint8Array<ArrayBuffer>) {
  return {
    statusCode: 200 as const,
    stream: new Blob([body]).stream(),
    headers: new Headers(),
    blob: {
      url: `https://store.private.blob.vercel-storage.com/${pathname}`,
      downloadUrl: `https://store.private.blob.vercel-storage.com/${pathname}?download=1`,
      pathname,
      contentType: "application/gzip",
      contentDisposition: "",
      cacheControl: "",
      size: body.byteLength,
      uploadedAt: new Date(0),
      etag: "etag",
    },
  };
}

/** A Blob SDK whose reads fail with these HTTP statuses before succeeding. */
async function flakyBlobStore(statuses: readonly number[]) {
  const pathname = "ingestion-runs/run/hollanderstores/chunk-AbC123.json.gz";
  const body = new Uint8Array(
    gzipSync(JSON.stringify({ vehicles: [], observedVins: ["VIN1"] })),
  );
  const failures = [...statuses];
  const sleeps: number[] = [];
  let reads = 0;
  const store = IngestionSnapshotStore.vercelBlob(
    "local-test-token",
    {
      put,
      del,
      async get(urlOrPathname) {
        reads += 1;
        const status = failures.shift();
        if (status !== undefined)
          throw new BlobError(`Failed to fetch blob: ${status} Status`);
        return blobResponse(urlOrPathname, body);
      },
    },
    async (ms) => {
      sleeps.push(ms);
    },
  );
  return { store, pathname, sleeps, reads: () => reads };
}

test("Blob reads back off and retry when the store rate limits or fails", async () => {
  const blob = await flakyBlobStore([429, 503, 429]);

  expect((await blob.store.load(blob.pathname)).observedVins).toEqual(["VIN1"]);
  expect(blob.reads()).toBe(4);
  expect(blob.sleeps).toEqual([1_000, 2_000, 4_000]);
});

test("Blob reads give up after the retry budget with the status and what is preserved", async () => {
  const blob = await flakyBlobStore(Array.from({ length: 10 }, () => 429));

  await expect(blob.store.load(blob.pathname)).rejects.toThrow(
    /HTTP 429 after 6 attempts.*staged chunk and its run are preserved/,
  );
  expect(blob.reads()).toBe(6);
  expect(blob.sleeps).toEqual([1_000, 2_000, 4_000, 8_000, 16_000]);
});

test("Blob reads do not retry a request the store rejects", async () => {
  const blob = await flakyBlobStore([403]);

  await expect(blob.store.load(blob.pathname)).rejects.toThrow(
    "Failed to fetch blob: 403",
  );
  expect(blob.reads()).toBe(1);
  expect(blob.sleeps).toEqual([]);
});

test("checkpoint state is stored apart from chunks and recognized by its path", async () => {
  const store = IngestionSnapshotStore.memory();
  const chunk = await store.put({
    runId: "run",
    source: "hollanderstores",
    chunk: { vehicles: [], observedVins: ["VIN1"] },
  });
  const state = await store.putCheckpointState({
    runId: "run",
    source: "hollanderstores",
    state: { census: ["VIN1"] },
  });

  expect(IngestionSnapshotStore.isCheckpointStatePath(chunk)).toBe(false);
  expect(IngestionSnapshotStore.isCheckpointStatePath(state)).toBe(true);
  // Old chunks that embedded their checkpoint state are ordinary chunks.
  expect(
    IngestionSnapshotStore.isCheckpointStatePath(
      "ingestion-runs/run/hollanderstores/chunk-AbC123.json.gz",
    ),
  ).toBe(false);
  expect(await store.load(state)).toEqual({
    vehicles: [],
    observedVins: [],
    checkpointState: { census: ["VIN1"] },
  });
});

test("Blob checkpoint state goes under its own folder of the run", async () => {
  const puts: string[] = [];
  const store = IngestionSnapshotStore.vercelBlob("local-test-token", {
    get,
    del,
    async put(pathname) {
      puts.push(pathname);
      return {
        pathname: pathname.replace(".json.gz", "-AbC123.json.gz"),
        url: "",
        downloadUrl: "",
        contentType: "application/gzip",
        contentDisposition: "",
        etag: "etag",
      };
    },
  });

  const state = await store.putCheckpointState({
    runId: "run",
    source: "hollanderstores",
    state: { census: [] },
  });

  expect(puts).toEqual([
    "ingestion-runs/run/hollanderstores/checkpoint-state/state.json.gz",
  ]);
  expect(IngestionSnapshotStore.isCheckpointStatePath(state)).toBe(true);
});

test("a missing checkpoint state says a newer checkpoint may have replaced it", async () => {
  const store = IngestionSnapshotStore.vercelBlob("local-test-token", {
    put,
    del,
    get: async () => null,
  });

  await expect(
    store.load(
      "ingestion-runs/run/hollanderstores/checkpoint-state/state-AbC123.json.gz",
    ),
  ).rejects.toThrow(
    /newer checkpoint of the same source run replaced it.*retrying the step resumes/,
  );
  await expect(
    store.load("ingestion-runs/run/hollanderstores/chunk-AbC123.json.gz"),
  ).rejects.toThrow(
    "is missing from Blob storage. The run cannot be reconciled",
  );
});

/** A Blob SDK backed by a map that counts reads. */
function countingBlobStore() {
  const blobs = new Map<string, Uint8Array<ArrayBuffer>>();
  let reads = 0;
  let suffix = 0;
  const client: { del: typeof del; get: typeof get; put: typeof put } = {
    async put(pathname, body) {
      if (!(body instanceof Uint8Array)) throw new Error("expected bytes");
      suffix += 1;
      const stored = pathname.replace(".json.gz", `-${suffix}.json.gz`);
      blobs.set(stored, new Uint8Array(body));
      return {
        pathname: stored,
        url: "",
        downloadUrl: "",
        contentType: "application/gzip",
        contentDisposition: "",
        etag: "etag",
      };
    },
    async get(pathname) {
      reads += 1;
      const body = blobs.get(pathname);
      return body ? blobResponse(pathname, body) : null;
    },
    async del(urls) {
      for (const url of typeof urls === "string" ? [urls] : urls)
        blobs.delete(url);
    },
  };
  return { client, reads: () => reads };
}

test("a chunk or state this process staged or read loads again without a Blob read", async () => {
  const blob = countingBlobStore();
  const writer = IngestionSnapshotStore.vercelBlob(
    "local-test-token",
    blob.client,
  );
  // Provider fetchers open their own store; they share the process cache.
  const reader = IngestionSnapshotStore.vercelBlob(
    "local-test-token",
    blob.client,
  );
  const state = await writer.putCheckpointState({
    runId: "run",
    source: "hollanderstores",
    state: { census: ["VIN1"] },
  });
  const chunk = await writer.put({
    runId: "run",
    source: "hollanderstores",
    chunk: { vehicles: [], observedVins: ["VIN1"] },
  });

  expect((await reader.load(state)).checkpointState).toEqual({
    census: ["VIN1"],
  });
  expect((await reader.load(chunk)).observedVins).toEqual(["VIN1"]);
  expect((await reader.load(chunk)).observedVins).toEqual(["VIN1"]);
  expect(blob.reads()).toBe(0);
});

test("a cached load returns a fresh copy each time", async () => {
  const blob = countingBlobStore();
  const store = IngestionSnapshotStore.vercelBlob(
    "local-test-token",
    blob.client,
  );
  const chunk = await store.put({
    runId: "run",
    source: "pyp",
    chunk: { vehicles: [], observedVins: ["VIN1"] },
  });

  (await store.load(chunk)).observedVins.push("MUTATED");

  expect((await store.load(chunk)).observedVins).toEqual(["VIN1"]);
});

test("a deleted chunk is not served from the process cache", async () => {
  const blob = countingBlobStore();
  const store = IngestionSnapshotStore.vercelBlob(
    "local-test-token",
    blob.client,
  );
  const state = await store.putCheckpointState({
    runId: "run",
    source: "hollanderstores",
    state: { census: [] },
  });

  await store.delete([state], { kind: "best-effort" });

  await expect(store.load(state)).rejects.toThrow(
    /newer checkpoint of the same source run replaced it/,
  );
  expect(blob.reads()).toBe(1);
});
