import type { IngestionSource } from "~/lib/ingestion-source";

export type PipelineSourceName = IngestionSource;

export interface PipelineSourceOutcome {
  source: PipelineSourceName;
  count: number;
  errors: string[];
}

export function determineHealthySources(
  outcomes: PipelineSourceOutcome[],
): PipelineSourceName[] {
  return outcomes
    .filter((outcome) => outcome.errors.length === 0)
    .map((outcome) => outcome.source);
}

export function shouldAdvanceMissingState(
  outcomes: PipelineSourceOutcome[],
): boolean {
  return outcomes.every((outcome) => outcome.errors.length === 0);
}

export function shouldReportHeartbeatFailure(
  outcomes: PipelineSourceOutcome[],
): boolean {
  return outcomes.some((outcome) => outcome.errors.length > 0);
}
