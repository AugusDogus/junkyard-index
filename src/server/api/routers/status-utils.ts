export type IngestionStatus =
  | "operational"
  | "in_progress"
  | "degraded"
  | "down";

export function mapRunStatus(status: string): IngestionStatus {
  switch (status) {
    case "success":
      return "operational";
    case "running":
      return "in_progress";
    case "partial":
      return "degraded";
    case "error":
      return "down";
    default:
      console.warn(`[Status] Unexpected ingestion status: ${status}`);
      return "down";
  }
}

const STATUS_SEVERITY: Record<IngestionStatus, number> = {
  operational: 0,
  in_progress: 1,
  degraded: 2,
  down: 3,
};

export function worstStatus(statuses: IngestionStatus[]): IngestionStatus {
  let worst: IngestionStatus = "operational";
  for (const status of statuses) {
    if (STATUS_SEVERITY[status] > STATUS_SEVERITY[worst]) {
      worst = status;
    }
  }
  return worst;
}

export function parseErrors(errorsJson: string | null): string[] | null {
  if (!errorsJson) return null;
  try {
    const parsed: unknown = JSON.parse(errorsJson);
    if (Array.isArray(parsed)) {
      return parsed.filter((entry): entry is string => typeof entry === "string");
    }
    return null;
  } catch {
    return null;
  }
}
