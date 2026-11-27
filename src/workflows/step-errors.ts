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

/** Longest context a step failure message carries after its cause. */
const CONTEXT_MAX = 500;

/**
 * The operation, its cause, then any context (such as the cursor it ran on)
 * cut to CONTEXT_MAX characters. The cause comes before the context so
 * trackers that keep only the start of a message (Sentry keeps 16,384
 * characters) still show it.
 */
export function stepFailureMessage(
  operation: string,
  error: unknown,
  context?: string,
): string {
  const message = `${operation} failed: ${formatError(error)}`;
  if (context === undefined) return message;
  const bounded =
    context.length <= CONTEXT_MAX
      ? context
      : `${context.slice(0, CONTEXT_MAX)}... (${context.length.toLocaleString("en-US")} characters)`;
  return `${message}\n${bounded}`;
}

/** Rethrows a step failure as retryable, with jittered exponential backoff. */
export function throwRetryableStepError(
  operation: string,
  error: unknown,
  context?: string,
): never {
  console.error(`[Workflow] ${operation} failed`, error);
  const { attempt } = getStepMetadata();
  const baseDelayMs = Math.min(30_000, 1_000 * 2 ** Math.max(0, attempt - 1));
  const retryAfter = Math.round(baseDelayMs * (0.5 + Math.random()));
  throw new RetryableError(stepFailureMessage(operation, error, context), {
    retryAfter,
  });
}
