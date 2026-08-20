import { describe, expect, test } from "bun:test";
import { INGESTION_SOURCES } from "~/lib/ingestion-source";
import { runIngestion } from "~/server/ingestion/run";

const smokeTest = process.env.RUN_INGESTION_SMOKE === "1" ? test : test.skip;

describe("ingestion smoke", () => {
  smokeTest(
    "runs durable ingestion against real configured dependencies",
    async () => {
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
