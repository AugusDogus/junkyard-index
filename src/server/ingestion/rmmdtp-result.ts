export interface RmmdtpError {
  tag: "RmmdtpError";
  operation: string;
  message: string;
}
export type RmmdtpResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: RmmdtpError };
export const RmmdtpResult = {
  error(operation: string, detail: string): RmmdtpError {
    return {
      tag: "RmmdtpError",
      operation,
      message: `RMMDTP ${operation}: ${detail}. Prior inventory is preserved; inspect the saved native evidence and resume the last validated checkpoint.`,
    };
  },
  boundary<T>(operation: string, run: () => T): RmmdtpResult<T> {
    try {
      return { ok: true, value: run() };
    } catch (cause) {
      return {
        ok: false,
        error: RmmdtpResult.error(
          operation,
          cause instanceof Error ? cause.message : String(cause),
        ),
      };
    }
  },
} as const;
