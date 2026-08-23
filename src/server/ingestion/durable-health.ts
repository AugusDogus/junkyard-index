export function isDurableIngestionUnhealthy(run: {
  status: string;
  inventoryOutcome: string | null;
  inventoryErrors: readonly string[];
}): boolean {
  return (
    run.status !== "success" ||
    run.inventoryOutcome !== "published" ||
    run.inventoryErrors.length > 0
  );
}
