export interface PrattError {
  tag: "PrattError";
  operation: string;
  message: string;
}
export type PrattResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: PrattError };
export const PrattResult = {
  error(operation: string, detail: string): PrattError {
    return {
      tag: "PrattError",
      operation,
      message: `Pratt ${operation}: ${detail}. Prior inventory is preserved; inspect the native evidence and resume from the last validated checkpoint.`,
    };
  },
  boundary<T>(operation: string, run: () => T): PrattResult<T> {
    try {
      return { ok: true, value: run() };
    } catch (cause) {
      return {
        ok: false,
        error: PrattResult.error(
          operation,
          cause instanceof Error ? cause.message : String(cause),
        ),
      };
    }
  },
} as const;
