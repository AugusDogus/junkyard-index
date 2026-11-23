import { expect, test } from "bun:test";
import { del, get, put } from "@vercel/blob";
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
