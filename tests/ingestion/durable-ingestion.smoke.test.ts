import { describe, expect, test } from "bun:test";

const smokeTest = process.env.RUN_INGESTION_SMOKE === "1" ? test : test.skip;

describe("ingestion smoke", () => {
  smokeTest(
    "runs durable ingestion against real configured dependencies",
    async () => {
      const [{ INGESTION_SOURCES }, { runIngestion }] = await Promise.all([
        import("~/lib/ingestion-source"),
        import("~/server/ingestion/run"),
      ]);
      const result = await runIngestion();

      expect(result.totalUpserted).toBeGreaterThanOrEqual(0);
      expect(result.totalDeleted).toBeGreaterThanOrEqual(0);
      for (const source of INGESTION_SOURCES) {
        expect(result.counts[source]).toBeGreaterThanOrEqual(0);
      }
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    },
  );
});
