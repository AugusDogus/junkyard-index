import { describe, expect, test } from "bun:test";

const smokeTest =
  process.env.RUN_INGESTION_SMOKE === "1" ? test : test.skip;

describe("algolia projector smoke", () => {
  smokeTest("runs the projector against real configured dependencies", async () => {
    const { runAlgoliaProjector } = await import(
      "~/server/ingestion/algolia-projector"
    );
    const result = await runAlgoliaProjector({ batchSize: 100 });

    expect(result.batchesProcessed).toBeGreaterThanOrEqual(0);
    expect(result.changesProcessed).toBeGreaterThanOrEqual(0);
    expect(result.upsertsSynced).toBeGreaterThanOrEqual(0);
    expect(result.deletesSynced).toBeGreaterThanOrEqual(0);
    expect(result.lastProcessedChangeId).toBeGreaterThanOrEqual(0);
  });
});
