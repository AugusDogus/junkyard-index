import { describe, expect, test } from "bun:test";
import { runIngestionPipeline } from "~/server/ingestion/run-pipeline";

const smokeTest =
  process.env.RUN_INGESTION_SMOKE === "1" ? test : test.skip;

describe("ingestion smoke", () => {
  smokeTest("runs the ingestion pipeline against real configured dependencies", async () => {
    const result = await runIngestionPipeline();

    expect(result.totalUpserted).toBeGreaterThanOrEqual(0);
    expect(result.totalDeleted).toBeGreaterThanOrEqual(0);
    expect(result.pypCount).toBeGreaterThanOrEqual(0);
    expect(result.row52Count).toBeGreaterThanOrEqual(0);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.timingsMs.sourcesParallelMs).toBeGreaterThanOrEqual(0);
    expect(result.timingsMs.row52FetchMs).toBeGreaterThanOrEqual(0);
    expect(result.timingsMs.pypFetchMs).toBeGreaterThanOrEqual(0);
  });
});
