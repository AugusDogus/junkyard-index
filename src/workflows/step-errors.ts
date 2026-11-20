import { RetryableError, getStepMetadata } from "workflow";

export function formatError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

/** Rethrows a step failure as retryable, with jittered exponential backoff. */
export function throwRetryableStepError(
  operation: string,
  error: unknown,
): never {
  console.error(`[Workflow] ${operation} failed`, error);
  const { attempt } = getStepMetadata();
  const baseDelayMs = Math.min(30_000, 1_000 * 2 ** Math.max(0, attempt - 1));
  const retryAfter = Math.round(baseDelayMs * (0.5 + Math.random()));
  throw new RetryableError(`${operation} failed: ${formatError(error)}`, {
    retryAfter,
  });
}
