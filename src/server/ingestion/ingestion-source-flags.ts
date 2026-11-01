import { flagsClient, Reason, type EvaluationResult } from "@vercel/flags-core";
import {
  INGESTION_SOURCES,
  type IngestionSource,
} from "~/lib/ingestion-source";

// Vercel Flags pause a broken provider without a deploy. Serve false for a
// source's `ingestion-source-<source>` boolean flag to leave it out of new
// ingestion runs. A missing flag, or a failed evaluation, keeps the source
// enabled. New Vercel flags serve false in production, so creating one pauses
// its source immediately.
export const IngestionSourceFlags = {
  key(source: IngestionSource): string {
    return `ingestion-source-${source}`;
  },

  resolve(
    results: Readonly<Record<string, EvaluationResult<unknown> | undefined>>,
  ): IngestionSource[] {
    return INGESTION_SOURCES.filter((source) => {
      const key = IngestionSourceFlags.key(source);
      const result = results[key];
      if (!result) return true;
      if (result.reason === Reason.ERROR) {
        if (result.errorCode !== "FLAG_NOT_FOUND") {
          console.error(
            `Could not evaluate Vercel flag ${key}; ingesting ${source} as enabled: ${result.errorMessage}`,
          );
        }
        return true;
      }
      if (typeof result.value !== "boolean") {
        console.error(
          `Vercel flag ${key} served ${JSON.stringify(result.value)}, not a boolean; ingesting ${source} as enabled. Make it a boolean flag.`,
        );
        return true;
      }
      return result.value;
    });
  },

  async enabledSources(): Promise<IngestionSource[]> {
    const results = await flagsClient.bulkEvaluate<unknown>(
      INGESTION_SOURCES.map((source) => ({
        key: IngestionSourceFlags.key(source),
        defaultValue: true,
      })),
    );
    return IngestionSourceFlags.resolve(results);
  },
} as const;
