export type IngestionStatus =
  | "operational"
  | "in_progress"
  | "degraded"
  | "down";

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
