import { flagsClient, Reason, type EvaluationResult } from "@vercel/flags-core";
import {
  INGESTION_SOURCES,
  type IngestionSource,
} from "~/lib/ingestion-source";

// Vercel Flags pause a broken provider without a deploy. Serve false for a
// source's `ingestion-source-<source>` boolean flag to leave it out of new
// ingestion runs. Missing/unreadable flags use the source default. Only the
// established sources below default on; all new sources require explicit rollout.
// New Vercel flags serve false in production, so creating one pauses its source.
const DEFAULT_ENABLED_SOURCES: ReadonlySet<IngestionSource> = new Set([
  "row52",
  "pyp",
  "autorecycler",
  "pullapart",
  "upullitne",
  "upullitdavie",
  "gopullit",
  "pullnsave",
  "tearapart",
  "wrenchapart",
  "upullrparts",
  "ipullupull",
  "upullitwa",
  "partsgalore",
]);
function enabledByDefault(source: IngestionSource): boolean {
  return DEFAULT_ENABLED_SOURCES.has(source);
}

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
      const fallback = enabledByDefault(source);
      if (!result) return fallback;
      if (result.reason === Reason.ERROR) {
        if (result.errorCode !== "FLAG_NOT_FOUND") {
          console.error(
            `Could not evaluate Vercel flag ${key}; using ${fallback ? "enabled" : "disabled"} default for ${source}: ${result.errorMessage}`,
          );
        }
        return fallback;
      }
      if (typeof result.value !== "boolean") {
        console.error(
          `Vercel flag ${key} served ${JSON.stringify(result.value)}, not a boolean; using ${fallback ? "enabled" : "disabled"} default for ${source}. Make it a boolean flag.`,
        );
        return fallback;
      }
      return result.value;
    });
  },

  async enabledSources(): Promise<IngestionSource[]> {
    const results = await flagsClient.bulkEvaluate<unknown>(
      INGESTION_SOURCES.map((source) => ({
        key: IngestionSourceFlags.key(source),
        defaultValue: enabledByDefault(source),
      })),
    );
    return IngestionSourceFlags.resolve(results);
  },
} as const;
