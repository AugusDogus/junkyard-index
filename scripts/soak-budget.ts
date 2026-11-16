import type { BudgetStreamResult } from "../src/server/ingestion/budget-connector";
import { BudgetCursor } from "../src/server/ingestion/budget-cursor";

/** Opening/closing pages and two owner controls, without persistence. */
export async function soakBudgetInventory(
  runChunk: (
    cursor: BudgetCursor,
    maxPages: number,
  ) => Promise<BudgetStreamResult>,
  maxRequests = 202,
): Promise<BudgetStreamResult> {
  if (!Number.isSafeInteger(maxRequests) || maxRequests < 1)
    throw new Error("Budget soak requires a positive integer GET budget");
  let cursor = BudgetCursor.initial();
  let pagesProcessed = 0;
  while (pagesProcessed < maxRequests) {
    const budget = Math.min(8, maxRequests - pagesProcessed);
    const before = JSON.stringify(cursor);
    const chunk = await runChunk(cursor, budget);
    const wire = JSON.stringify(chunk.cursor);
    if (Buffer.byteLength(wire) > 8 * 1024 * 1024)
      throw new Error("Budget serialized checkpoint exceeds 8 MiB");
    const next = BudgetCursor.fromWire(wire);
    if (
      !Number.isSafeInteger(chunk.pagesProcessed) ||
      chunk.pagesProcessed < 0 ||
      chunk.pagesProcessed > budget ||
      (chunk.status === "complete") !== (next.phase === "complete") ||
      (chunk.status === "paused" &&
        (chunk.pagesProcessed === 0 || wire === before || chunk.count !== 0))
    )
      throw new Error(
        "Budget soak made no valid progress; retain the last checkpoint and inspect the native response",
      );
    pagesProcessed += chunk.pagesProcessed;
    cursor = next;
    if (chunk.status === "complete" || pagesProcessed === maxRequests)
      return { ...chunk, cursor, pagesProcessed };
  }
  throw new Error("Budget soak exhausted its GET budget without a result");
}
