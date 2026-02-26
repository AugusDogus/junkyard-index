import pRetry, { AbortError } from "p-retry";

interface FetchWithRetryOptions {
  context: string;
  logPrefix: string;
  timeoutMs: number;
  retries: number;
  baseDelayMs: number;
  retryStatusCodes?: number[];
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function isTimeoutError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const lowerMessage = error.message.toLowerCase();
  return (
    error.name === "TimeoutError" ||
    error.name === "AbortError" ||
    lowerMessage.includes("aborted due to timeout") ||
    lowerMessage.includes("timeout")
  );
}

export async function fetchWithTimeoutRetry(
  url: string,
  init: RequestInit,
  options: FetchWithRetryOptions,
): Promise<Response> {
  const totalAttempts = options.retries + 1;
  const retryStatusCodes = new Set(options.retryStatusCodes ?? []);

  return pRetry(
    async (attemptNumber) => {
      try {
        const response = await fetch(url, {
          ...init,
          signal: AbortSignal.timeout(options.timeoutMs),
        });

        if (retryStatusCodes.has(response.status)) {
          if (attemptNumber < totalAttempts) {
            const delayMs = options.baseDelayMs * 2 ** (attemptNumber - 1);
            console.warn(
              `${options.logPrefix} ${options.context} returned ${response.status} (attempt ${attemptNumber}/${totalAttempts}), retrying in ${delayMs}ms`,
            );
          }
          throw new Error(`Retryable HTTP status: ${response.status}`);
        }

        return response;
      } catch (error) {
        if (!isTimeoutError(error)) {
          if (
            error instanceof Error &&
            error.message.startsWith("Retryable HTTP status:")
          ) {
            throw error;
          }
          throw new AbortError(toErrorMessage(error));
        }

        if (attemptNumber < totalAttempts) {
          const delayMs = options.baseDelayMs * 2 ** (attemptNumber - 1);
          console.warn(
            `${options.logPrefix} ${options.context} timed out (attempt ${attemptNumber}/${totalAttempts}), retrying in ${delayMs}ms`,
          );
        }

        throw error instanceof Error ? error : new Error(toErrorMessage(error));
      }
    },
    {
      retries: options.retries,
      factor: 2,
      minTimeout: options.baseDelayMs,
      maxTimeout: options.baseDelayMs * 2 ** Math.max(options.retries - 1, 0),
      randomize: false,
    },
  );
}
