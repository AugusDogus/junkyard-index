import {
  isIngestionSource,
  type IngestionSource,
} from "~/lib/ingestion-source";

export type DurableRunStage =
  | "sources"
  | "reconcile_upsert"
  | "reconcile_missing"
  | "project_changes"
  | "full_reindex_prepare"
  | "full_reindex_load"
  | "full_reindex_publish"
  | "full_reindex_move_pending"
  | "full_reindex_publish_failed"
  | "match_alerts"
  | "released";

export function parseDurableRunStage(value: string): DurableRunStage {
  switch (value) {
    case "sources":
    case "reconcile_upsert":
    case "reconcile_missing":
    case "project_changes":
    case "full_reindex_prepare":
    case "full_reindex_load":
    case "full_reindex_publish":
    case "full_reindex_move_pending":
    case "full_reindex_publish_failed":
    case "match_alerts":
    case "released":
      return value;
    default:
      throw new Error(`Unknown durable ingestion stage: ${value}`);
  }
}

export function parseAcceptedSources(value: string | null): IngestionSource[] {
  if (value === null) {
    throw new Error("Durable ingestion accepted sources are missing.");
  }
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed) || !parsed.every(isIngestionSource)) {
      throw new Error("accepted_sources must be an array of ingestion sources");
    }
    if (new Set(parsed).size !== parsed.length) {
      throw new Error("accepted_sources must not contain duplicates");
    }
    return parsed;
  } catch (error) {
    const reason = error instanceof Error ? error.message : "invalid JSON";
    throw new Error(
      `Durable ingestion accepted sources are invalid: ${reason}`,
    );
  }
}
