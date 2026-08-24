export type DurableIngestionHealth = "healthy" | "degraded" | "down";

export function classifyDurableIngestionHealth(run: {
  status: string;
  inventoryOutcome: string | null;
  inventoryErrors: readonly string[];
}): DurableIngestionHealth {
  if (run.status !== "success" || run.inventoryOutcome === null) return "down";
  if (
    run.inventoryOutcome === "published_degraded" ||
    run.inventoryErrors.length > 0
  ) {
    return "degraded";
  }
  return run.inventoryOutcome === "published" ? "healthy" : "down";
}
