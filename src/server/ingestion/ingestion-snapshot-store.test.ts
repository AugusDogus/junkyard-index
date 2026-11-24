import { expect, test } from "bun:test";
import { gzipSync } from "node:zlib";
import { BlobError, del, get, put } from "@vercel/blob";
import { IngestionSnapshotStore } from "./ingestion-snapshot-store";

test("Blob delete splits a large run's chunks under the 1,000 URL limit", async () => {
  const calls: string[][] = [];
  const sdk: { del: typeof del; get: typeof get; put: typeof put } = {
    get,
    put,
    async del(urls, options) {
      expect(options?.token).toBe("local-test-token");
      const batch = typeof urls === "string" ? [urls] : urls;
      if (batch.length > 1_000)
        throw new Error(
          "Vercel Blob: Cannot delete more than 1,000 urls at once",
        );
      calls.push(batch);
    },
  };
  const store = IngestionSnapshotStore.vercelBlob("local-test-token", sdk);
  const pathnames = Array.from(
    { length: 2_213 },
    (_, index) => `ingestion-runs/run/urgiis/${index}.json.gz`,
  );

  await store.delete(pathnames);

  expect(calls.map((batch) => batch.length)).toEqual([1_000, 1_000, 213]);
  expect(calls.flat()).toEqual(pathnames);
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

  await store.delete([]);

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
