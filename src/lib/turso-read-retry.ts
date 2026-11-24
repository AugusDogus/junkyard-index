import { LibsqlError } from "@libsql/client/web";

/** Gateway statuses Turso's edge returns during brief upstream outages. */
const TRANSIENT_HTTP_STATUSES: ReadonlySet<number> = new Set([502, 503, 504]);

const ATTEMPTS = 3;
const BASE_DELAY_MS = 200;

/**
 * True for a LibsqlError raised because Turso's HTTP endpoint answered with a
 * gateway status (502, 503 or 504), alone or as the cause of Drizzle's
 * DrizzleQueryError, which wraps every failed query. The HTTP client reports
 * those as `SERVER_ERROR` with the status on its cause. SQL errors and other
 * statuses are not transient: retrying them would fail the same way.
 */
export function isTransientTursoError(error: unknown): boolean {
  // Bounded, so a cyclic cause chain cannot loop.
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current instanceof Error; depth += 1) {
    if (current instanceof LibsqlError) return isGatewayError(current);
    current = current.cause;
  }
  return false;
}

function isGatewayError(error: LibsqlError): boolean {
  if (error.code !== "SERVER_ERROR") return false;
  const cause: unknown = error.cause;
  return (
    typeof cause === "object" &&
    cause !== null &&
    "status" in cause &&
    typeof cause.status === "number" &&
    TRANSIENT_HTTP_STATUSES.has(cause.status)
  );
}

export type TursoReadRetryOptions = {
  /** Waits between attempts; tests pass a recorder. */
  sleep?: (ms: number) => Promise<void>;
  /** Reports each retry; defaults to console.warn. */
  warn?: (message: string) => void;
};

/**
 * Runs an idempotent Turso read, retrying up to twice (200 ms, then 400 ms)
 * when Turso answers with a transient gateway error, so a one-minute edge
 * blip does not turn page renders and status checks into 500s. Rethrows the
 * last error once attempts run out, and any other error at once. Only wrap
 * reads: a retried write could apply twice.
 */
export async function retryTursoRead<T>(
  read: () => Promise<T>,
  {
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    warn = console.warn,
  }: TursoReadRetryOptions = {},
): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await read();
    } catch (error) {
      if (attempt >= ATTEMPTS || !isTransientTursoError(error)) throw error;
      const delayMs = BASE_DELAY_MS * 2 ** (attempt - 1);
      const message = describe(error);
      warn(
        `Turso read failed with a transient server error (${message}); retrying in ${delayMs} ms (attempt ${attempt + 1} of ${ATTEMPTS}).`,
      );
      await sleep(delayMs);
    }
  }
}

/** The libsql message under any Drizzle wrapper, for the retry warning. */
function describe(error: unknown): string {
  if (error instanceof Error && error.cause instanceof LibsqlError) {
    return error.cause.message;
  }
  return error instanceof Error ? error.message : String(error);
}
