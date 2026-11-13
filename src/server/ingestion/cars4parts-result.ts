export interface Cars4PartsError {
  tag: "Cars4PartsError";
  operation: string;
  message: string;
}
export type Cars4PartsResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: Cars4PartsError };
export const Cars4PartsResult = {
  error(operation: string, detail: string): Cars4PartsError {
    return {
      tag: "Cars4PartsError",
      operation,
      message: `Cars4Parts ${operation}: ${detail}. Prior inventory is preserved; inspect the saved native evidence before resuming the last validated checkpoint.`,
    };
  },
  boundary<T>(operation: string, run: () => T): Cars4PartsResult<T> {
    try {
      return { ok: true, value: run() };
    } catch (cause) {
      return {
        ok: false,
        error: Cars4PartsResult.error(
          operation,
          cause instanceof Error ? cause.message : String(cause),
        ),
      };
    }
  },
} as const;
