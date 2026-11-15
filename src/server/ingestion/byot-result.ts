export type ByotError = {
  readonly _tag: "ByotError";
  readonly message: string;
};
export type ByotResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: ByotError };
export const ByotResult = {
  error(operation: string, detail: string): ByotError {
    return {
      _tag: "ByotError",
      message: `BYOT ${operation}: ${detail}. Retain the last validated checkpoint and inspect the saved response before retrying.`,
    };
  },
  boundary<T>(operation: string, action: () => T): ByotResult<T> {
    try {
      return { ok: true, value: action() };
    } catch (cause) {
      return {
        ok: false,
        error: ByotResult.error(
          operation,
          cause instanceof Error ? cause.message : String(cause),
        ),
      };
    }
  },
} as const;
